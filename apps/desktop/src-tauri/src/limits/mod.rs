//! Limit threshold math (pure, tested) and the reminder orchestration that
//! runs after each minute flush.

use std::sync::Arc;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::store::Store;
use crate::timeutil;

/// Reminder thresholds, percent of the limit. Custom thresholds are Phase 2.
pub const DEFAULT_THRESHOLDS: [u32; 3] = [50, 80, 100];

/// Which thresholds newly crossed: usage has reached them and they have not
/// fired yet. Pure function — the only place limit math lives.
pub fn thresholds_to_fire(limit_secs: i64, used_secs: i64, already_fired: &[u32]) -> Vec<u32> {
    if limit_secs <= 0 || used_secs <= 0 {
        return Vec::new();
    }
    DEFAULT_THRESHOLDS
        .iter()
        .copied()
        .filter(|pct| used_secs * 100 >= limit_secs * (*pct as i64))
        .filter(|pct| !already_fired.contains(pct))
        .collect()
}

fn reminder_text(target_key: &str, pct: u32, used_secs: i64, limit_secs: i64) -> (String, String) {
    let used_m = used_secs / 60;
    let limit_m = limit_secs / 60;
    let title = if pct >= 100 {
        format!("{target_key}: daily limit reached")
    } else {
        format!("{target_key}: {pct}% of daily limit")
    };
    let body = format!("{used_m} min used of your {limit_m} min daily limit.");
    (title, body)
}

/// Evaluate all enabled daily limits against today's usage and fire system
/// notifications for newly crossed thresholds (deduped via reminder_log).
pub fn check_and_fire(app: &AppHandle, store: &Arc<Store>) {
    let date = timeutil::today_local();
    let (start, end) = match timeutil::local_day_bounds(&date) {
        Ok(b) => b,
        Err(e) => {
            log::error!("limit check skipped: {e}");
            return;
        }
    };

    let limits = match store.list_limits() {
        Ok(l) => l,
        Err(e) => {
            log::error!("limit check failed to list limits: {e}");
            return;
        }
    };

    for limit in limits.iter().filter(|l| l.enabled && l.period == "daily") {
        let used = match store.usage_total(&limit.target_kind, &limit.target_key, start, end) {
            Ok(u) => u,
            Err(e) => {
                log::error!("usage query failed for {}: {e}", limit.target_key);
                continue;
            }
        };
        let fired = store.fired_thresholds(limit.id, &date).unwrap_or_default();
        for pct in thresholds_to_fire(limit.limit_secs, used, &fired) {
            let (title, body) = reminder_text(&limit.target_key, pct, used, limit.limit_secs);
            if let Err(e) = app.notification().builder().title(&title).body(&body).show() {
                log::error!("notification failed: {e}");
            }
            let now = chrono::Utc::now().timestamp();
            if let Err(e) = store.log_reminder(limit.id, &date, pct, now) {
                log::error!("failed to log reminder: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_fires_below_first_threshold() {
        assert!(thresholds_to_fire(3600, 0, &[]).is_empty());
        assert!(thresholds_to_fire(3600, 1799, &[]).is_empty());
    }

    #[test]
    fn fires_exactly_at_threshold() {
        assert_eq!(thresholds_to_fire(3600, 1800, &[]), vec![50]);
        assert_eq!(thresholds_to_fire(3600, 2880, &[]), vec![50, 80]);
        assert_eq!(thresholds_to_fire(3600, 3600, &[]), vec![50, 80, 100]);
    }

    #[test]
    fn a_jump_fires_all_skipped_thresholds_once() {
        // e.g. agent was off, usage arrives in a burst from the extension buffer
        assert_eq!(thresholds_to_fire(600, 700, &[]), vec![50, 80, 100]);
    }

    #[test]
    fn already_fired_thresholds_are_suppressed() {
        assert_eq!(thresholds_to_fire(3600, 3700, &[50, 80]), vec![100]);
        assert!(thresholds_to_fire(3600, 3700, &[50, 80, 100]).is_empty());
    }

    #[test]
    fn over_limit_keeps_quiet_after_100_fired() {
        assert!(thresholds_to_fire(3600, 7200, &[50, 80, 100]).is_empty());
    }

    #[test]
    fn degenerate_limits_never_fire() {
        assert!(thresholds_to_fire(0, 1000, &[]).is_empty());
        assert!(thresholds_to_fire(-5, 1000, &[]).is_empty());
    }

    #[test]
    fn reminder_text_is_humane() {
        let (title, body) = reminder_text("youtube.com", 80, 2880, 3600);
        assert_eq!(title, "youtube.com: 80% of daily limit");
        assert_eq!(body, "48 min used of your 60 min daily limit.");
        let (title, _) = reminder_text("youtube.com", 100, 3600, 3600);
        assert_eq!(title, "youtube.com: daily limit reached");
    }
}
