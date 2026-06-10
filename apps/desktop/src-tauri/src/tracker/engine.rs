//! Pure tracking state machine: 1-second samples in, completed 1-minute buckets out.
//! No OS or database access — everything here is unit-testable.

use std::collections::BTreeMap;

pub const BUCKET_SECS: i64 = 60;

/// One 1 Hz observation of the system.
#[derive(Debug, Clone)]
pub struct Sample {
    /// Unix epoch seconds.
    pub ts: i64,
    /// Stable identifier of the foreground app (e.g. "chrome.exe"); None when
    /// no foreground window exists (locked screen, secure desktop, …).
    pub app_key: Option<String>,
    /// Human-readable app name (e.g. "Google Chrome").
    pub app_name: Option<String>,
    /// Seconds since last user input, system-wide.
    pub idle_secs: u64,
}

/// One flushed minute bucket for a single app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageRecord {
    pub bucket_ts: i64,
    pub key: String,
    pub label: String,
    pub active_secs: u32,
    pub idle_secs: u32,
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// A sample counts as idle when idle_secs >= this threshold.
    pub idle_threshold_secs: u64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self { idle_threshold_secs: 60 }
    }
}

#[derive(Debug, Default)]
struct Acc {
    label: String,
    active: u32,
    idle: u32,
}

/// Accumulates samples into per-(minute, app) buckets and emits buckets once
/// their minute has passed.
pub struct Engine {
    cfg: EngineConfig,
    pending: BTreeMap<(i64, String), Acc>,
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> Self {
        Self { cfg, pending: BTreeMap::new() }
    }

    fn bucket_of(ts: i64) -> i64 {
        ts - ts.rem_euclid(BUCKET_SECS)
    }

    /// Feed one sample. Returns any minute buckets completed by the passage of
    /// time (i.e. buckets strictly older than this sample's minute).
    pub fn on_sample(&mut self, s: &Sample) -> Vec<UsageRecord> {
        let bucket = Self::bucket_of(s.ts);
        let flushed = self.flush_before(bucket);

        if let Some(key) = &s.app_key {
            let acc = self
                .pending
                .entry((bucket, key.clone()))
                .or_insert_with(Acc::default);
            if acc.label.is_empty() {
                acc.label = s.app_name.clone().unwrap_or_else(|| key.clone());
            }
            if s.idle_secs >= self.cfg.idle_threshold_secs {
                acc.idle += 1;
            } else {
                acc.active += 1;
            }
        }
        flushed
    }

    /// Emit every pending bucket older than `bucket`.
    fn flush_before(&mut self, bucket: i64) -> Vec<UsageRecord> {
        let keys: Vec<(i64, String)> = self
            .pending
            .range(..(bucket, String::new()))
            .map(|(k, _)| k.clone())
            .collect();
        keys.into_iter()
            .map(|k| {
                let acc = self.pending.remove(&k).expect("key collected from map");
                UsageRecord {
                    bucket_ts: k.0,
                    key: k.1,
                    label: acc.label,
                    active_secs: acc.active,
                    idle_secs: acc.idle,
                }
            })
            .collect()
    }

    /// Emit everything still pending (shutdown / pause).
    pub fn flush_all(&mut self) -> Vec<UsageRecord> {
        self.flush_before(i64::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(ts: i64, app: &str, idle: u64) -> Sample {
        Sample {
            ts,
            app_key: Some(app.to_string()),
            app_name: Some(format!("{app} (friendly)")),
            idle_secs: idle,
        }
    }

    fn engine() -> Engine {
        Engine::new(EngineConfig { idle_threshold_secs: 60 })
    }

    #[test]
    fn accumulates_active_seconds_within_a_minute() {
        let mut e = engine();
        for i in 0..30 {
            assert!(e.on_sample(&sample(120 + i, "code.exe", 0)).is_empty());
        }
        let out = e.flush_all();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].bucket_ts, 120);
        assert_eq!(out[0].active_secs, 30);
        assert_eq!(out[0].idle_secs, 0);
        assert_eq!(out[0].key, "code.exe");
        assert_eq!(out[0].label, "code.exe (friendly)");
    }

    #[test]
    fn classifies_idle_at_threshold_boundary() {
        let mut e = engine();
        e.on_sample(&sample(0, "code.exe", 59)); // active (below threshold)
        e.on_sample(&sample(1, "code.exe", 60)); // idle (at threshold)
        e.on_sample(&sample(2, "code.exe", 300)); // idle
        let out = e.flush_all();
        assert_eq!(out[0].active_secs, 1);
        assert_eq!(out[0].idle_secs, 2);
    }

    #[test]
    fn flushes_on_minute_rollover() {
        let mut e = engine();
        for i in 0..60 {
            assert!(e.on_sample(&sample(i, "code.exe", 0)).is_empty());
        }
        // First sample of the next minute flushes the previous bucket.
        let out = e.on_sample(&sample(60, "code.exe", 0));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].bucket_ts, 0);
        assert_eq!(out[0].active_secs, 60);
        // The new minute keeps accumulating.
        let rest = e.flush_all();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].bucket_ts, 60);
        assert_eq!(rest[0].active_secs, 1);
    }

    #[test]
    fn app_switch_mid_minute_yields_two_records_in_same_bucket() {
        let mut e = engine();
        for i in 0..20 {
            e.on_sample(&sample(i, "chrome.exe", 0));
        }
        for i in 20..60 {
            e.on_sample(&sample(i, "slack.exe", 0));
        }
        let mut out = e.flush_all();
        out.sort_by(|a, b| a.key.cmp(&b.key));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].key, "chrome.exe");
        assert_eq!(out[0].active_secs, 20);
        assert_eq!(out[1].key, "slack.exe");
        assert_eq!(out[1].active_secs, 40);
        assert!(out.iter().all(|r| r.bucket_ts == 0));
    }

    #[test]
    fn no_foreground_app_accumulates_nothing_but_still_flushes() {
        let mut e = engine();
        e.on_sample(&sample(0, "code.exe", 0));
        // Screen locks: samples with no app for the rest of the minute.
        let none = Sample { ts: 61, app_key: None, app_name: None, idle_secs: 500 };
        let out = e.on_sample(&none);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].active_secs, 1);
        assert!(e.flush_all().is_empty());
    }

    #[test]
    fn gap_in_samples_flushes_all_intermediate_buckets() {
        let mut e = engine();
        e.on_sample(&sample(0, "code.exe", 0));
        // Machine slept for 10 minutes; next sample lands far later.
        let out = e.on_sample(&sample(600, "code.exe", 0));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].bucket_ts, 0);
        assert_eq!(out[0].active_secs, 1);
    }

    #[test]
    fn total_attributed_seconds_equals_sample_count() {
        let mut e = engine();
        let mut total_flushed = 0u32;
        let apps = ["a.exe", "b.exe", "c.exe"];
        for i in 0..500i64 {
            let app = apps[(i / 37) as usize % apps.len()];
            let idle = if i % 5 == 0 { 120 } else { 0 };
            for r in e.on_sample(&sample(1000 + i, app, idle)) {
                total_flushed += r.active_secs + r.idle_secs;
            }
        }
        for r in e.flush_all() {
            total_flushed += r.active_secs + r.idle_secs;
        }
        assert_eq!(total_flushed, 500);
    }
}
