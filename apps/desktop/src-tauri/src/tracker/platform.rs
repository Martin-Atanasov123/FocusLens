//! OS access for the sampler. Everything OS-specific is behind `SystemProbe`
//! so the engine and sampler logic stay platform-independent and testable.
//!
//! `active-win-pos-rs` covers Windows (Win32 GetForegroundWindow) and macOS
//! (CoreGraphics window list); `user-idle` covers GetLastInputInfo / IOKit.

use super::engine::Sample;

pub trait SystemProbe: Send + 'static {
    /// Observe the current foreground app and system idle time.
    fn sample(&self, now_ts: i64) -> Sample;
}

pub struct OsProbe;

impl SystemProbe for OsProbe {
    fn sample(&self, now_ts: i64) -> Sample {
        let idle_secs = user_idle::UserIdle::get_time()
            .map(|t| t.as_seconds())
            .unwrap_or(0);

        match active_win_pos_rs::get_active_window() {
            Ok(win) => {
                let key = win
                    .process_path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| win.app_name.to_lowercase());
                let name = if win.app_name.is_empty() { key.clone() } else { win.app_name };
                Sample {
                    ts: now_ts,
                    app_key: if key.is_empty() { None } else { Some(key) },
                    app_name: Some(name),
                    idle_secs,
                }
            }
            // No foreground window (lock screen, secure desktop, transient failures).
            Err(_) => Sample { ts: now_ts, app_key: None, app_name: None, idle_secs },
        }
    }
}
