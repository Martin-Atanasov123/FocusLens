-- FocusLens schema. Append-only: add migrations below, never edit shipped DDL.

CREATE TABLE IF NOT EXISTS usage_minutes (
    bucket_ts   INTEGER NOT NULL,            -- unix seconds, floored to the minute
    source      TEXT    NOT NULL CHECK (source IN ('desktop', 'extension', 'mobile')),
    kind        TEXT    NOT NULL CHECK (kind IN ('app', 'domain', 'category')),
    key         TEXT    NOT NULL,            -- e.g. 'chrome.exe' or 'youtube.com'
    label       TEXT,                        -- human-readable name
    active_secs INTEGER NOT NULL DEFAULT 0,
    idle_secs   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_ts, source, kind, key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_usage_kind_key_ts ON usage_minutes (kind, key, bucket_ts);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_minutes (bucket_ts);

CREATE TABLE IF NOT EXISTS limits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_kind TEXT    NOT NULL CHECK (target_kind IN ('app', 'domain', 'category')),
    target_key  TEXT    NOT NULL,
    period      TEXT    NOT NULL DEFAULT 'daily' CHECK (period IN ('daily', 'weekly')),
    limit_secs  INTEGER NOT NULL CHECK (limit_secs > 0),
    limit_type  TEXT    NOT NULL DEFAULT 'soft' CHECK (limit_type IN ('soft', 'hard')),
    enabled     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (target_kind, target_key, period)
);

CREATE TABLE IF NOT EXISTS reminder_log (
    limit_id      INTEGER NOT NULL REFERENCES limits(id) ON DELETE CASCADE,
    date          TEXT    NOT NULL,          -- local date YYYY-MM-DD
    threshold_pct INTEGER NOT NULL,
    fired_at      INTEGER NOT NULL,
    PRIMARY KEY (limit_id, date, threshold_pct)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Phase 2 tables (category system) — created now so the schema stays append-only.
CREATE TABLE IF NOT EXISTS categories (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL UNIQUE,
    productivity_weight REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    pattern     TEXT    NOT NULL,            -- glob, e.g. '*.youtube.com'
    target_kind TEXT    NOT NULL DEFAULT 'domain' CHECK (target_kind IN ('app', 'domain'))
);
