//! SQLite persistence layer. All access goes through `Store`, which owns a
//! single connection behind a mutex (writes are minute-granularity — no
//! contention to speak of).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

use crate::timeutil;
use crate::tracker::engine::UsageRecord;

const SCHEMA: &str = include_str!("schema.sql");

pub const DEFAULT_RETENTION_DAYS: i64 = 90;
pub const DEFAULT_IDLE_THRESHOLD_SECS: u64 = 60;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntryRow {
    pub key: String,
    pub label: String,
    pub active_secs: i64,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DaySummary {
    pub date: String,
    pub total_active_secs: i64,
    pub apps: Vec<EntryRow>,
    pub domains: Vec<EntryRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LimitRow {
    pub id: i64,
    pub target_kind: String,
    pub target_key: String,
    pub period: String,
    pub limit_secs: i64,
    pub limit_type: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LimitInput {
    pub id: Option<i64>,
    pub target_kind: String,
    pub target_key: String,
    pub period: String,
    pub limit_secs: i64,
    pub limit_type: String,
    pub enabled: bool,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    // ---- usage -------------------------------------------------------------

    /// Insert minute buckets, accumulating on conflict (same bucket/app may be
    /// flushed twice around restarts or arrive in parts from the extension).
    pub fn upsert_usage(&self, source: &str, kind: &str, records: &[UsageRecord]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO usage_minutes (bucket_ts, source, kind, key, label, active_secs, idle_secs)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (bucket_ts, source, kind, key) DO UPDATE SET
                     active_secs = active_secs + excluded.active_secs,
                     idle_secs   = idle_secs + excluded.idle_secs,
                     label       = COALESCE(excluded.label, label)",
            )?;
            for r in records {
                stmt.execute(params![r.bucket_ts, source, kind, r.key, r.label, r.active_secs, r.idle_secs])?;
            }
        }
        tx.commit()
    }

    pub fn day_summary(&self, date: &str) -> Result<DaySummary> {
        let (start, end) = timeutil::local_day_bounds(date)
            .map_err(|e| rusqlite::Error::InvalidParameterName(e))?;
        let conn = self.conn.lock().unwrap();

        let fetch = |kind: &str, source: &str| -> Result<Vec<EntryRow>> {
            let mut stmt = conn.prepare_cached(
                "SELECT key, COALESCE(MAX(label), key) AS label, SUM(active_secs) AS active
                 FROM usage_minutes
                 WHERE kind = ?1 AND source = ?2 AND bucket_ts >= ?3 AND bucket_ts < ?4
                 GROUP BY key
                 HAVING SUM(active_secs) > 0
                 ORDER BY active DESC",
            )?;
            let rows = stmt.query_map(params![kind, source, start, end], |row| {
                Ok(EntryRow {
                    key: row.get(0)?,
                    label: row.get(1)?,
                    active_secs: row.get(2)?,
                    source: source.to_string(),
                })
            })?;
            rows.collect()
        };

        let apps = fetch("app", "desktop")?;
        let domains = fetch("domain", "extension")?;
        // Desktop app-level time is the wall-clock baseline; domain rows cover
        // the same clock time inside browsers, so the total uses apps only.
        let total_active_secs = apps.iter().map(|e| e.active_secs).sum();

        Ok(DaySummary { date: date.to_string(), total_active_secs, apps, domains })
    }

    /// Total active seconds for one target over [start, end), summed across sources.
    pub fn usage_total(&self, kind: &str, key: &str, start: i64, end: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(SUM(active_secs), 0) FROM usage_minutes
             WHERE kind = ?1 AND key = ?2 AND bucket_ts >= ?3 AND bucket_ts < ?4",
            params![kind, key, start, end],
            |row| row.get(0),
        )
    }

    // ---- limits ------------------------------------------------------------

    pub fn list_limits(&self) -> Result<Vec<LimitRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare_cached(
            "SELECT id, target_kind, target_key, period, limit_secs, limit_type, enabled
             FROM limits ORDER BY target_key",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LimitRow {
                id: row.get(0)?,
                target_kind: row.get(1)?,
                target_key: row.get(2)?,
                period: row.get(3)?,
                limit_secs: row.get(4)?,
                limit_type: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
            })
        })?;
        rows.collect()
    }

    pub fn upsert_limit(&self, l: &LimitInput) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        match l.id {
            Some(id) => {
                conn.execute(
                    "UPDATE limits SET target_kind = ?1, target_key = ?2, period = ?3,
                     limit_secs = ?4, limit_type = ?5, enabled = ?6 WHERE id = ?7",
                    params![l.target_kind, l.target_key, l.period, l.limit_secs, l.limit_type, l.enabled as i64, id],
                )?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO limits (target_kind, target_key, period, limit_secs, limit_type, enabled)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT (target_kind, target_key, period) DO UPDATE SET
                         limit_secs = excluded.limit_secs,
                         limit_type = excluded.limit_type,
                         enabled    = excluded.enabled",
                    params![l.target_kind, l.target_key, l.period, l.limit_secs, l.limit_type, l.enabled as i64],
                )?;
                conn.query_row(
                    "SELECT id FROM limits WHERE target_kind = ?1 AND target_key = ?2 AND period = ?3",
                    params![l.target_kind, l.target_key, l.period],
                    |row| row.get(0),
                )
            }
        }
    }

    pub fn delete_limit(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM limits WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---- reminders ---------------------------------------------------------

    pub fn fired_thresholds(&self, limit_id: i64, date: &str) -> Result<Vec<u32>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare_cached("SELECT threshold_pct FROM reminder_log WHERE limit_id = ?1 AND date = ?2")?;
        let rows = stmt.query_map(params![limit_id, date], |row| row.get(0))?;
        rows.collect()
    }

    pub fn log_reminder(&self, limit_id: i64, date: &str, pct: u32, now: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO reminder_log (limit_id, date, threshold_pct, fired_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![limit_id, date, pct, now],
        )?;
        Ok(())
    }

    // ---- settings ----------------------------------------------------------

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .optional()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn retention_days(&self) -> i64 {
        self.get_setting("retention_days")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_RETENTION_DAYS)
    }

    pub fn idle_threshold_secs(&self) -> u64 {
        self.get_setting("idle_threshold_secs")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_IDLE_THRESHOLD_SECS)
    }

    // ---- retention ---------------------------------------------------------

    /// Delete usage and reminder rows older than the configured retention window.
    pub fn apply_retention(&self, now: i64) -> Result<usize> {
        let cutoff = now - self.retention_days() * 86_400;
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM usage_minutes WHERE bucket_ts < ?1", params![cutoff])?;
        conn.execute("DELETE FROM reminder_log WHERE fired_at < ?1", params![cutoff])?;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(bucket_ts: i64, key: &str, active: u32, idle: u32) -> UsageRecord {
        UsageRecord {
            bucket_ts,
            key: key.into(),
            label: key.to_uppercase(),
            active_secs: active,
            idle_secs: idle,
        }
    }

    #[test]
    fn upsert_accumulates_on_conflict() {
        let s = Store::open_in_memory().unwrap();
        s.upsert_usage("desktop", "app", &[rec(60, "code.exe", 30, 5)]).unwrap();
        s.upsert_usage("desktop", "app", &[rec(60, "code.exe", 10, 2)]).unwrap();
        let total = s.usage_total("app", "code.exe", 0, 120).unwrap();
        assert_eq!(total, 40);
    }

    #[test]
    fn usage_total_respects_range_kind_and_key() {
        let s = Store::open_in_memory().unwrap();
        s.upsert_usage("desktop", "app", &[rec(60, "code.exe", 30, 0), rec(120, "code.exe", 20, 0)])
            .unwrap();
        s.upsert_usage("extension", "domain", &[rec(60, "youtube.com", 50, 0)]).unwrap();
        assert_eq!(s.usage_total("app", "code.exe", 0, 121).unwrap(), 50);
        assert_eq!(s.usage_total("app", "code.exe", 0, 120).unwrap(), 30);
        assert_eq!(s.usage_total("domain", "youtube.com", 0, 121).unwrap(), 50);
        assert_eq!(s.usage_total("domain", "code.exe", 0, 121).unwrap(), 0);
    }

    #[test]
    fn limits_crud_and_unique_target_upsert() {
        let s = Store::open_in_memory().unwrap();
        let input = LimitInput {
            id: None,
            target_kind: "domain".into(),
            target_key: "youtube.com".into(),
            period: "daily".into(),
            limit_secs: 3600,
            limit_type: "soft".into(),
            enabled: true,
        };
        let id1 = s.upsert_limit(&input).unwrap();
        // Same target upserts instead of duplicating.
        let id2 = s.upsert_limit(&LimitInput { limit_secs: 1800, ..input.clone() }).unwrap();
        assert_eq!(id1, id2);
        let limits = s.list_limits().unwrap();
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0].limit_secs, 1800);

        s.delete_limit(id1).unwrap();
        assert!(s.list_limits().unwrap().is_empty());
    }

    #[test]
    fn reminder_log_dedupes_per_day_and_threshold() {
        let s = Store::open_in_memory().unwrap();
        let id = s
            .upsert_limit(&LimitInput {
                id: None,
                target_kind: "app".into(),
                target_key: "slack.exe".into(),
                period: "daily".into(),
                limit_secs: 600,
                limit_type: "soft".into(),
                enabled: true,
            })
            .unwrap();
        s.log_reminder(id, "2026-06-10", 50, 1000).unwrap();
        s.log_reminder(id, "2026-06-10", 50, 2000).unwrap(); // ignored duplicate
        s.log_reminder(id, "2026-06-10", 80, 3000).unwrap();
        let mut fired = s.fired_thresholds(id, "2026-06-10").unwrap();
        fired.sort();
        assert_eq!(fired, vec![50, 80]);
        assert!(s.fired_thresholds(id, "2026-06-11").unwrap().is_empty());
    }

    #[test]
    fn retention_removes_only_old_rows() {
        let s = Store::open_in_memory().unwrap();
        let now = 100 * 86_400;
        let old = now - 91 * 86_400;
        let recent = now - 89 * 86_400;
        s.upsert_usage("desktop", "app", &[rec(old, "old.exe", 10, 0), rec(recent, "new.exe", 10, 0)])
            .unwrap();
        let removed = s.apply_retention(now).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(s.usage_total("app", "old.exe", 0, now).unwrap(), 0);
        assert_eq!(s.usage_total("app", "new.exe", 0, now).unwrap(), 10);
    }

    #[test]
    fn settings_roundtrip_and_defaults() {
        let s = Store::open_in_memory().unwrap();
        assert_eq!(s.retention_days(), DEFAULT_RETENTION_DAYS);
        assert_eq!(s.idle_threshold_secs(), DEFAULT_IDLE_THRESHOLD_SECS);
        s.set_setting("retention_days", "30").unwrap();
        assert_eq!(s.retention_days(), 30);
        s.set_setting("pairing_token", "abc123").unwrap();
        assert_eq!(s.get_setting("pairing_token").unwrap().as_deref(), Some("abc123"));
    }
}
