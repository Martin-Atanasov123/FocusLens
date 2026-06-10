//! 1 Hz sampling thread: probe → engine → store → limit checks.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

use crate::limits;
use crate::store::Store;

use super::engine::{Engine, EngineConfig, Sample};
use super::platform::SystemProbe;

/// Seconds between retention sweeps (1 hour).
const RETENTION_SWEEP_EVERY: u64 = 3600;

pub fn spawn<P: SystemProbe>(
    app: AppHandle,
    store: Arc<Store>,
    paused: Arc<AtomicBool>,
    probe: P,
    idle_threshold_secs: u64,
) {
    std::thread::Builder::new()
        .name("focuslens-sampler".into())
        .spawn(move || run_loop(app, store, paused, probe, idle_threshold_secs))
        .expect("failed to spawn sampler thread");
}

fn run_loop<P: SystemProbe>(
    app: AppHandle,
    store: Arc<Store>,
    paused: Arc<AtomicBool>,
    probe: P,
    idle_threshold_secs: u64,
) {
    let mut engine = Engine::new(EngineConfig { idle_threshold_secs });
    let mut ticks: u64 = 0;

    loop {
        std::thread::sleep(Duration::from_secs(1));
        ticks += 1;
        let now = chrono::Utc::now().timestamp();

        // While paused we feed empty samples so pending buckets still flush.
        let sample = if paused.load(Ordering::Relaxed) {
            Sample { ts: now, app_key: None, app_name: None, idle_secs: 0 }
        } else {
            probe.sample(now)
        };

        let flushed = engine.on_sample(&sample);
        if !flushed.is_empty() {
            if let Err(e) = store.upsert_usage("desktop", "app", &flushed) {
                log::error!("failed to store usage buckets: {e}");
            }
            limits::check_and_fire(&app, &store);
        }

        if ticks % RETENTION_SWEEP_EVERY == 0 {
            match store.apply_retention(now) {
                Ok(0) => {}
                Ok(n) => log::info!("retention sweep removed {n} rows"),
                Err(e) => log::error!("retention sweep failed: {e}"),
            }
        }
    }
}
