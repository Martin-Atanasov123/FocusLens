//! Tauri invoke handlers — the dashboard's only interface to the core.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::store::{DaySummary, LimitInput, Store};
use crate::timeutil;

pub struct AppState {
    pub store: Arc<Store>,
    pub paused: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWithUsage {
    pub id: i64,
    pub target_kind: String,
    pub target_key: String,
    pub period: String,
    pub limit_secs: i64,
    pub limit_type: String,
    pub enabled: bool,
    pub used_secs_today: i64,
}

#[tauri::command]
pub fn get_day_summary(state: State<AppState>, date: Option<String>) -> Result<DaySummary, String> {
    let date = date.unwrap_or_else(timeutil::today_local);
    state.store.day_summary(&date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_limits(state: State<AppState>) -> Result<Vec<LimitWithUsage>, String> {
    let date = timeutil::today_local();
    let (start, end) = timeutil::local_day_bounds(&date)?;
    let limits = state.store.list_limits().map_err(|e| e.to_string())?;
    limits
        .into_iter()
        .map(|l| {
            let used = state
                .store
                .usage_total(&l.target_kind, &l.target_key, start, end)
                .map_err(|e| e.to_string())?;
            Ok(LimitWithUsage {
                id: l.id,
                target_kind: l.target_kind,
                target_key: l.target_key,
                period: l.period,
                limit_secs: l.limit_secs,
                limit_type: l.limit_type,
                enabled: l.enabled,
                used_secs_today: used,
            })
        })
        .collect()
}

#[tauri::command]
pub fn upsert_limit(state: State<AppState>, limit: LimitInput) -> Result<i64, String> {
    if limit.limit_secs <= 0 {
        return Err("limit must be greater than zero".into());
    }
    if !["app", "domain"].contains(&limit.target_kind.as_str()) {
        return Err("Phase 1 supports app and domain limits".into());
    }
    if limit.target_key.trim().is_empty() {
        return Err("target is required".into());
    }
    state.store.upsert_limit(&limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_limit(state: State<AppState>, id: i64) -> Result<(), String> {
    state.store.delete_limit(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pairing_token(state: State<AppState>) -> Result<String, String> {
    state
        .store
        .get_setting("pairing_token")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "pairing token not initialized".into())
}

#[tauri::command]
pub fn get_tracking_paused(state: State<AppState>) -> bool {
    state.paused.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_tracking_paused(state: State<AppState>, paused: bool) {
    state.paused.store(paused, Ordering::Relaxed);
}
