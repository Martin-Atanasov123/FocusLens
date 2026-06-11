"""SQLite persistence layer."""
from __future__ import annotations

import secrets
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from .engine import UsageRecord
from .timeutil import local_day_bounds

DEFAULT_RETENTION_DAYS = 90
DEFAULT_IDLE_THRESHOLD = 60

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage_minutes (
    bucket_ts   INTEGER NOT NULL,
    source      TEXT    NOT NULL,
    kind        TEXT    NOT NULL,
    key         TEXT    NOT NULL,
    label       TEXT,
    active_secs INTEGER NOT NULL DEFAULT 0,
    idle_secs   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_ts, source, kind, key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_usage_ts    ON usage_minutes (bucket_ts);
CREATE INDEX IF NOT EXISTS idx_usage_kind  ON usage_minutes (kind, key, bucket_ts);

CREATE TABLE IF NOT EXISTS limits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_kind TEXT    NOT NULL,
    target_key  TEXT    NOT NULL,
    period      TEXT    NOT NULL DEFAULT 'daily',
    limit_secs  INTEGER NOT NULL,
    limit_type  TEXT    NOT NULL DEFAULT 'soft',
    enabled     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (target_kind, target_key, period)
);

CREATE TABLE IF NOT EXISTS reminder_log (
    limit_id      INTEGER NOT NULL REFERENCES limits(id) ON DELETE CASCADE,
    date          TEXT    NOT NULL,
    threshold_pct INTEGER NOT NULL,
    fired_at      INTEGER NOT NULL,
    PRIMARY KEY (limit_id, date, threshold_pct)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL UNIQUE,
    productivity_weight REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    pattern     TEXT    NOT NULL,
    target_kind TEXT    NOT NULL DEFAULT 'domain'
);
"""


class Store:
    def __init__(self, db_path: str | Path = ":memory:") -> None:
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        self._ensure_pairing_token()

    def _ensure_pairing_token(self) -> None:
        if self.get_setting("pairing_token") is None:
            token = secrets.token_urlsafe(24)
            self.set_setting("pairing_token", token)

    # ---- settings ----------------------------------------------------------

    def get_setting(self, key: str) -> Optional[str]:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
            return row["value"] if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            self._conn.commit()

    def retention_days(self) -> int:
        v = self.get_setting("retention_days")
        try:
            return int(v) if v else DEFAULT_RETENTION_DAYS
        except ValueError:
            return DEFAULT_RETENTION_DAYS

    def idle_threshold_secs(self) -> float:
        v = self.get_setting("idle_threshold_secs")
        try:
            return float(v) if v else float(DEFAULT_IDLE_THRESHOLD)
        except ValueError:
            return float(DEFAULT_IDLE_THRESHOLD)

    # ---- usage -------------------------------------------------------------

    def upsert_usage(self, source: str, kind: str, records: list[UsageRecord]) -> None:
        if not records:
            return
        with self._lock:
            self._conn.executemany(
                """INSERT INTO usage_minutes
                       (bucket_ts, source, kind, key, label, active_secs, idle_secs)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (bucket_ts, source, kind, key) DO UPDATE SET
                       active_secs = active_secs + excluded.active_secs,
                       idle_secs   = idle_secs   + excluded.idle_secs,
                       label       = COALESCE(excluded.label, label)""",
                [
                    (r.bucket_ts, source, kind, r.key, r.label, r.active_secs, r.idle_secs)
                    for r in records
                ],
            )
            self._conn.commit()

    def replace_usage(self, source: str, kind: str, records: list[UsageRecord]) -> None:
        """Upsert that REPLACES active_secs instead of accumulating.

        Used for snapshot sources (e.g. the Android companion) that report a
        running daily total against a fixed bucket — repeated syncs overwrite
        the same row, so totals stay correct without double-counting.
        """
        if not records:
            return
        with self._lock:
            self._conn.executemany(
                """INSERT INTO usage_minutes
                       (bucket_ts, source, kind, key, label, active_secs, idle_secs)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (bucket_ts, source, kind, key) DO UPDATE SET
                       active_secs = excluded.active_secs,
                       label       = COALESCE(excluded.label, label)""",
                [
                    (r.bucket_ts, source, kind, r.key, r.label, r.active_secs, r.idle_secs)
                    for r in records
                ],
            )
            self._conn.commit()

    def usage_total(self, kind: str, key: str, start: int, end: int) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COALESCE(SUM(active_secs), 0) FROM usage_minutes"
                " WHERE kind = ? AND key = ? AND bucket_ts >= ? AND bucket_ts < ?",
                (kind, key, start, end),
            ).fetchone()
            return int(row[0])

    def day_summary(self, date_str: str) -> dict:
        start, end = local_day_bounds(date_str)
        with self._lock:
            apps = self._conn.execute(
                """SELECT key, COALESCE(MAX(label), key) AS label,
                          SUM(active_secs) AS active, 'desktop' AS source
                   FROM usage_minutes
                   WHERE kind = 'app' AND source = 'desktop'
                     AND bucket_ts >= ? AND bucket_ts < ?
                   GROUP BY key HAVING active > 0 ORDER BY active DESC""",
                (start, end),
            ).fetchall()
            domains = self._conn.execute(
                """SELECT key, COALESCE(MAX(label), key) AS label,
                          SUM(active_secs) AS active, 'extension' AS source
                   FROM usage_minutes
                   WHERE kind = 'domain' AND source = 'extension'
                     AND bucket_ts >= ? AND bucket_ts < ?
                   GROUP BY key HAVING active > 0 ORDER BY active DESC""",
                (start, end),
            ).fetchall()

        total = sum(r["active"] for r in apps)
        return {
            "date": date_str,
            "totalActiveSecs": total,
            "apps": [
                {"key": r["key"], "label": r["label"], "activeSecs": r["active"], "source": r["source"]}
                for r in apps
            ],
            "domains": [
                {"key": r["key"], "label": r["label"], "activeSecs": r["active"], "source": r["source"]}
                for r in domains
            ],
        }

    # ---- limits ------------------------------------------------------------

    def list_limits(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, target_kind, target_key, period, limit_secs, limit_type, enabled"
                " FROM limits ORDER BY target_key"
            ).fetchall()
            return [dict(r) for r in rows]

    def upsert_limit(self, data: dict) -> int:
        lid = data.get("id")
        with self._lock:
            if lid:
                self._conn.execute(
                    "UPDATE limits SET target_kind=?, target_key=?, period=?,"
                    " limit_secs=?, limit_type=?, enabled=? WHERE id=?",
                    (
                        data["target_kind"], data["target_key"], data["period"],
                        data["limit_secs"], data["limit_type"], int(data["enabled"]), lid,
                    ),
                )
                self._conn.commit()
                return lid
            self._conn.execute(
                """INSERT INTO limits (target_kind, target_key, period, limit_secs, limit_type, enabled)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT (target_kind, target_key, period) DO UPDATE SET
                       limit_secs = excluded.limit_secs,
                       limit_type = excluded.limit_type,
                       enabled    = excluded.enabled""",
                (
                    data["target_kind"], data["target_key"], data["period"],
                    data["limit_secs"], data["limit_type"], int(data["enabled"]),
                ),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT id FROM limits WHERE target_kind=? AND target_key=? AND period=?",
                (data["target_kind"], data["target_key"], data["period"]),
            ).fetchone()
            return row["id"]

    def delete_limit(self, lid: int) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM limits WHERE id = ?", (lid,))
            self._conn.commit()

    # ---- reminder log ------------------------------------------------------

    def fired_thresholds(self, limit_id: int, date_str: str) -> list[int]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT threshold_pct FROM reminder_log WHERE limit_id = ? AND date = ?",
                (limit_id, date_str),
            ).fetchall()
            return [r[0] for r in rows]

    def log_reminder(self, limit_id: int, date_str: str, pct: int, now: int) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO reminder_log (limit_id, date, threshold_pct, fired_at)"
                " VALUES (?, ?, ?, ?)",
                (limit_id, date_str, pct, now),
            )
            self._conn.commit()

    # ---- retention ---------------------------------------------------------

    def apply_retention(self, now: int) -> int:
        cutoff = now - self.retention_days() * 86_400
        with self._lock:
            n = self._conn.execute(
                "DELETE FROM usage_minutes WHERE bucket_ts < ?", (cutoff,)
            ).rowcount
            self._conn.execute(
                "DELETE FROM reminder_log WHERE fired_at < ?", (cutoff,)
            )
            self._conn.commit()
            return n
