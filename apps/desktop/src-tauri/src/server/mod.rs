//! Loopback HTTP server for the browser extension. Binds strictly to
//! 127.0.0.1 and requires the pairing token on every data route — hostnames
//! never leave the machine.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::limits;
use crate::store::Store;
use crate::timeutil;
use crate::tracker::engine::UsageRecord;

pub const PORT: u16 = 48732;
const TOKEN_HEADER: &str = "x-focuslens-token";
/// Cap a single POST body at 1 MiB — a day of minute buckets is ~100 KB.
const MAX_BODY_BYTES: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionEvent {
    bucket_ts: i64,
    domain: String,
    active_secs: u32,
}

#[derive(Deserialize)]
struct PostEventsRequest {
    events: Vec<ExtensionEvent>,
}

pub fn spawn(app: AppHandle, store: Arc<Store>, token: String, paused: Arc<AtomicBool>) {
    std::thread::Builder::new()
        .name("focuslens-server".into())
        .spawn(move || match Server::http(("127.0.0.1", PORT)) {
            Ok(server) => {
                log::info!("extension endpoint listening on 127.0.0.1:{PORT}");
                run(server, app, store, token, paused);
            }
            Err(e) => log::error!("failed to bind 127.0.0.1:{PORT}: {e}"),
        })
        .expect("failed to spawn server thread");
}

fn json_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = Response::from_string(body).with_status_code(status);
    for (k, v) in [
        ("Content-Type", "application/json"),
        // Loopback-only; permissive CORS lets the popup fetch without fuss.
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "content-type, x-focuslens-token"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
    ] {
        resp.add_header(Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("static header"));
    }
    resp
}

fn run(server: Server, app: AppHandle, store: Arc<Store>, token: String, paused: Arc<AtomicBool>) {
    for mut request in server.incoming_requests() {
        let method = request.method().clone();
        let url = request.url().to_string();
        let path = url.split('?').next().unwrap_or("");

        if method == Method::Options {
            let _ = request.respond(json_response(204, String::new()));
            continue;
        }

        let response = match (&method, path) {
            (Method::Get, "/ping") => json_response(200, r#"{"ok":true}"#.into()),
            _ => {
                let provided = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv(TOKEN_HEADER))
                    .map(|h| h.value.as_str().to_string());
                if provided.as_deref() != Some(token.as_str()) {
                    json_response(401, r#"{"error":"invalid or missing pairing token"}"#.into())
                } else {
                    match (&method, path) {
                        (Method::Post, "/events") => handle_events(&mut request, &app, &store, &paused),
                        (Method::Get, "/summary/today") => handle_summary(&store),
                        _ => json_response(404, r#"{"error":"not found"}"#.into()),
                    }
                }
            }
        };

        if let Err(e) = request.respond(response) {
            log::warn!("failed to respond to extension request: {e}");
        }
    }
}

fn handle_events(
    request: &mut tiny_http::Request,
    app: &AppHandle,
    store: &Arc<Store>,
    paused: &Arc<AtomicBool>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    if paused.load(Ordering::Relaxed) {
        // Tracking is paused: acknowledge so the extension drops the events
        // (the user asked not to record this time).
        return json_response(200, r#"{"accepted":0}"#.into());
    }

    let mut body = String::new();
    let mut reader = request.as_reader().take(MAX_BODY_BYTES as u64 + 1);
    if std::io::Read::read_to_string(&mut reader, &mut body).is_err() || body.len() > MAX_BODY_BYTES {
        return json_response(400, r#"{"error":"body too large or unreadable"}"#.into());
    }

    let parsed: PostEventsRequest = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(e) => return json_response(400, format!(r#"{{"error":"bad json: {e}"}}"#)),
    };

    let records: Vec<UsageRecord> = parsed
        .events
        .into_iter()
        .filter(|e| {
            !e.domain.is_empty()
                && e.domain.len() <= 253
                && (1..=60).contains(&e.active_secs)
                && e.bucket_ts > 0
                && e.bucket_ts % 60 == 0
        })
        .map(|e| UsageRecord {
            bucket_ts: e.bucket_ts,
            key: e.domain.clone(),
            label: e.domain,
            active_secs: e.active_secs,
            idle_secs: 0,
        })
        .collect();

    let accepted = records.len();
    if accepted > 0 {
        if let Err(e) = store.upsert_usage("extension", "domain", &records) {
            log::error!("failed to store extension events: {e}");
            return json_response(500, r#"{"error":"storage failure"}"#.into());
        }
        limits::check_and_fire(app, store);
    }
    json_response(200, format!(r#"{{"accepted":{accepted}}}"#))
}

fn handle_summary(store: &Arc<Store>) -> Response<std::io::Cursor<Vec<u8>>> {
    match store.day_summary(&timeutil::today_local()) {
        Ok(summary) => match serde_json::to_string(&summary) {
            Ok(json) => json_response(200, json),
            Err(e) => json_response(500, format!(r#"{{"error":"serialize: {e}"}}"#)),
        },
        Err(e) => json_response(500, format!(r#"{{"error":"query: {e}"}}"#)),
    }
}
