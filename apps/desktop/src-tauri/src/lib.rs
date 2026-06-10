pub mod commands;
pub mod limits;
pub mod server;
pub mod store;
pub mod timeutil;
pub mod tracker;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rand::Rng;
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

use commands::AppState;
use store::Store;
use tracker::platform::OsProbe;

fn ensure_pairing_token(store: &Store) -> Result<String, rusqlite::Error> {
    if let Some(token) = store.get_setting("pairing_token")? {
        return Ok(token);
    }
    let token: String = rand::thread_rng()
        .sample_iter(rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    store.set_setting("pairing_token", &token)?;
    Ok(token)
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = Arc::new(Store::open(&data_dir.join("focuslens.db"))?);
            let token = ensure_pairing_token(&store)?;
            let paused = Arc::new(AtomicBool::new(false));

            // Startup retention sweep; the sampler repeats it hourly.
            let now = chrono::Utc::now().timestamp();
            if let Err(e) = store.apply_retention(now) {
                log::error!("startup retention sweep failed: {e}");
            }

            let idle_threshold = store.idle_threshold_secs();
            server::spawn(app.handle().clone(), store.clone(), token, paused.clone());
            tracker::sampler::spawn(
                app.handle().clone(),
                store.clone(),
                paused.clone(),
                OsProbe,
                idle_threshold,
            );

            app.manage(AppState { store, paused: paused.clone() });

            // Tray: the app lives in the tray; closing the window only hides it.
            let open_item = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let pause_item =
                CheckMenuItem::with_id(app, "pause", "Pause Tracking", true, false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit FocusLens", true, None::<&str>)?;
            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&pause_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let pause_for_handler = pause_item.clone();
            TrayIconBuilder::with_id("focuslens-tray")
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .tooltip("FocusLens")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "pause" => {
                        let checked = pause_for_handler.is_checked().unwrap_or(false);
                        paused.store(checked, Ordering::Relaxed);
                        log::info!("tracking paused: {checked}");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_day_summary,
            commands::get_limits,
            commands::upsert_limit,
            commands::delete_limit,
            commands::get_pairing_token,
            commands::get_tracking_paused,
            commands::set_tracking_paused,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusLens");
}
