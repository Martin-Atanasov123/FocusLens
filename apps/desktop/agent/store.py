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

# Seeded once on first run; users edit rules afterwards via the dashboard.
# weight: +1 productive, 0 neutral, -1 distracting.
DEFAULT_CATEGORIES: list[tuple[str, float]] = [
    ("Productive", 1.0),
    ("Neutral", 0.0),
    ("Distracting", -1.0),
]

DEFAULT_RULES: list[tuple[str, str, str]] = [  # (category, pattern, target_kind)
    ("Productive", "code", "app"),
    ("Productive", "visual studio", "app"),
    ("Productive", "pycharm", "app"),
    ("Productive", "intellij", "app"),
    ("Productive", "terminal", "app"),
    ("Productive", "powershell", "app"),
    ("Productive", "excel", "app"),
    ("Productive", "word", "app"),
    ("Productive", "obsidian", "app"),
    ("Productive", "notion", "app"),
    ("Productive", "figma", "app"),
    ("Productive", "github.com", "domain"),
    ("Productive", "stackoverflow.com", "domain"),
    ("Productive", "docs.google.com", "domain"),
    ("Productive", "notion.so", "domain"),
    ("Productive", "wikipedia.org", "domain"),
    ("Distracting", "youtube.com", "domain"),
    ("Distracting", "facebook.com", "domain"),
    ("Distracting", "instagram.com", "domain"),
    ("Distracting", "tiktok.com", "domain"),
    ("Distracting", "twitter.com", "domain"),
    ("Distracting", "x.com", "domain"),
    ("Distracting", "reddit.com", "domain"),
    ("Distracting", "netflix.com", "domain"),
    ("Distracting", "twitch.tv", "domain"),
    ("Distracting", "steam", "app"),
    ("Distracting", "netflix", "app"),
]

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
        self._seed_categories()

    def _seed_categories(self) -> None:
        if self.get_setting("categories_seeded"):
            return
        with self._lock:
            for name, weight in DEFAULT_CATEGORIES:
                self._conn.execute(
                    "INSERT OR IGNORE INTO categories (name, productivity_weight) VALUES (?, ?)",
                    (name, weight),
                )
            ids = {
                r["name"]: r["id"]
                for r in self._conn.execute("SELECT id, name FROM categories")
            }
            for cat, pattern, kind in DEFAULT_RULES:
                self._conn.execute(
                    "INSERT INTO category_rules (category_id, pattern, target_kind) VALUES (?, ?, ?)",
                    (ids[cat], pattern, kind),
                )
            self._conn.commit()
        self.set_setting("categories_seeded", "1")

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

    # ---- categories ---------------------------------------------------------

    def list_categories(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, name, productivity_weight FROM categories ORDER BY productivity_weight DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def list_rules(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                """SELECT r.id, r.pattern, r.target_kind, c.name AS category,
                          c.productivity_weight AS weight
                   FROM category_rules r JOIN categories c ON c.id = r.category_id
                   ORDER BY c.productivity_weight DESC, r.pattern"""
            ).fetchall()
            return [dict(r) for r in rows]

    def add_rule(self, category_name: str, pattern: str, target_kind: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT id FROM categories WHERE name = ?", (category_name,)
            ).fetchone()
            if not row:
                raise ValueError(f"unknown category: {category_name}")
            cur = self._conn.execute(
                "INSERT INTO category_rules (category_id, pattern, target_kind) VALUES (?, ?, ?)",
                (row["id"], pattern.strip().lower(), target_kind),
            )
            self._conn.commit()
            return cur.lastrowid

    def delete_rule(self, rule_id: int) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM category_rules WHERE id = ?", (rule_id,))
            self._conn.commit()

    def _rules_matcher(self):
        """Returns classify(kind, key, label) -> (category_name, weight).

        Case-insensitive substring match; longest pattern wins so
        'docs.google.com' beats 'google.com'. Unmatched → Neutral/0.
        """
        rules = self.list_rules()
        rules.sort(key=lambda r: len(r["pattern"]), reverse=True)

        def classify(kind: str, key: str, label: str | None) -> tuple[str, float]:
            hay = ((key or "") + " " + (label or "")).lower()
            for r in rules:
                if r["target_kind"] in (kind, "any") and r["pattern"] in hay:
                    return r["category"], r["weight"]
            return "Neutral", 0.0

        return classify

    @staticmethod
    def _score(productive: int, neutral: int, distracting: int) -> int | None:
        """0–100: productive counts full, neutral half, distracting zero."""
        total = productive + neutral + distracting
        if total <= 0:
            return None
        return round(100 * (productive + 0.5 * neutral) / total)

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
            # Phone rows are namespaced per device as source = "android:<id>"
            # (legacy data is plain "android"); group by source so two phones
            # stay separate instead of merging.
            phone_apps = self._conn.execute(
                """SELECT source, key, COALESCE(MAX(label), key) AS label,
                          MAX(active_secs) AS active
                   FROM usage_minutes
                   WHERE kind = 'app' AND source LIKE 'android%'
                     AND bucket_ts >= ? AND bucket_ts < ?
                   GROUP BY source, key HAVING active > 0
                   ORDER BY active DESC""",
                (start, end),
            ).fetchall()
            device_names = {
                r["key"][len("android_device:"):]: r["value"]
                for r in self._conn.execute(
                    "SELECT key, value FROM settings WHERE key LIKE 'android_device:%'"
                ).fetchall()
            }

        classify = self._rules_matcher()
        desktop_total = sum(r["active"] for r in apps)
        phone_total = sum(r["active"] for r in phone_apps)

        cat_secs = {"Productive": 0, "Neutral": 0, "Distracting": 0}
        app_rows = []
        for r in apps:
            cat, weight = classify("app", r["key"], r["label"])
            cat_secs[cat] = cat_secs.get(cat, 0) + r["active"]
            app_rows.append(
                {"key": r["key"], "label": r["label"], "activeSecs": r["active"],
                 "source": r["source"], "category": cat, "weight": weight}
            )
        dom_rows = []
        for r in domains:
            cat, weight = classify("domain", r["key"], r["label"])
            dom_rows.append(
                {"key": r["key"], "label": r["label"], "activeSecs": r["active"],
                 "source": r["source"], "category": cat, "weight": weight}
            )
        # Group phone usage per device. phoneApps stays a flat combined list
        # (back-compat); phones breaks it down by device for the per-phone view.
        phones_map: dict[str, dict] = {}
        phone_rows = []
        for r in phone_apps:
            src = r["source"]
            dev_id = src.split(":", 1)[1] if ":" in src else ""
            dev_name = device_names.get(dev_id) or "Phone"
            cat, weight = classify("app", r["key"], r["label"])
            row = {"key": r["key"], "label": r["label"], "activeSecs": r["active"],
                   "source": "android", "category": cat, "weight": weight}
            dev = phones_map.setdefault(
                src, {"deviceId": dev_id, "name": dev_name, "activeSecs": 0, "apps": []}
            )
            dev["activeSecs"] += r["active"]
            dev["apps"].append(row)
            phone_rows.append(row)
        phones = sorted(phones_map.values(), key=lambda d: d["activeSecs"], reverse=True)

        return {
            "date": date_str,
            "totalActiveSecs": desktop_total,
            "phoneActiveSecs": phone_total,
            "allSourcesSecs": desktop_total + phone_total,
            "productivityScore": self._score(
                cat_secs["Productive"], cat_secs["Neutral"], cat_secs["Distracting"]
            ),
            "categorySecs": cat_secs,
            "apps": app_rows,
            "domains": dom_rows,
            "phoneApps": phone_rows,
            "phones": phones,
        }

    # ---- trends -------------------------------------------------------------

    def daily_totals(self, days: int, end_date: str) -> list[dict]:
        """Per-day totals for the `days` days ending at end_date (inclusive),
        oldest first. Each day: total active + per-category seconds + score.
        Desktop app rows only — the canonical machine-time measure."""
        from datetime import date, timedelta

        end = date.fromisoformat(end_date)
        start_str = (end - timedelta(days=days - 1)).isoformat()
        start_ts, _ = local_day_bounds(start_str)
        _, end_ts = local_day_bounds(end_date)

        with self._lock:
            rows = self._conn.execute(
                """SELECT date(bucket_ts, 'unixepoch', 'localtime') AS day,
                          key, COALESCE(MAX(label), key) AS label,
                          SUM(active_secs) AS active
                   FROM usage_minutes
                   WHERE kind = 'app' AND source = 'desktop'
                     AND bucket_ts >= ? AND bucket_ts < ?
                   GROUP BY day, key""",
                (start_ts, end_ts),
            ).fetchall()

        classify = self._rules_matcher()
        by_day: dict[str, dict] = {}
        for r in rows:
            d = by_day.setdefault(
                r["day"],
                {"total": 0, "Productive": 0, "Neutral": 0, "Distracting": 0},
            )
            cat, _ = classify("app", r["key"], r["label"])
            d["total"] += r["active"]
            d[cat] += r["active"]

        out = []
        for i in range(days):
            day = (end - timedelta(days=days - 1 - i)).isoformat()
            d = by_day.get(day, {"total": 0, "Productive": 0, "Neutral": 0, "Distracting": 0})
            out.append({
                "date": day,
                "activeSecs": d["total"],
                "productiveSecs": d["Productive"],
                "neutralSecs": d["Neutral"],
                "distractingSecs": d["Distracting"],
                "score": self._score(d["Productive"], d["Neutral"], d["Distracting"]),
            })
        return out

    def app_week_movers(self, end_date: str, top_n: int = 5) -> list[dict]:
        """Apps with the biggest absolute change: last 7 days vs previous 7."""
        from datetime import date, timedelta

        end = date.fromisoformat(end_date)
        mid_str = (end - timedelta(days=6)).isoformat()
        prev_start_str = (end - timedelta(days=13)).isoformat()
        this_start, _ = local_day_bounds(mid_str)
        prev_start, _ = local_day_bounds(prev_start_str)
        _, end_ts = local_day_bounds(end_date)

        with self._lock:
            rows = self._conn.execute(
                """SELECT key, COALESCE(MAX(label), key) AS label,
                          SUM(CASE WHEN bucket_ts >= ? THEN active_secs ELSE 0 END) AS this_week,
                          SUM(CASE WHEN bucket_ts <  ? THEN active_secs ELSE 0 END) AS last_week
                   FROM usage_minutes
                   WHERE kind = 'app' AND source = 'desktop'
                     AND bucket_ts >= ? AND bucket_ts < ?
                   GROUP BY key""",
                (this_start, this_start, prev_start, end_ts),
            ).fetchall()

        movers = [
            {
                "key": r["key"], "label": r["label"],
                "thisWeekSecs": r["this_week"], "lastWeekSecs": r["last_week"],
                "deltaSecs": r["this_week"] - r["last_week"],
            }
            for r in rows
            if r["this_week"] + r["last_week"] >= 300  # ignore noise under 5 min
        ]
        movers.sort(key=lambda m: abs(m["deltaSecs"]), reverse=True)
        return movers[:top_n]

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
