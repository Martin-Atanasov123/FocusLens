# FocusLens — Technology Decisions

Decisions as implemented. Earlier phases are recorded where they changed course,
because the "why we switched" matters more than the original pick.

## Desktop agent: Python (switched from Rust/Tauri)

Phase 1 started on Tauri 2 (Rust core + Svelte dashboard) for the resource
budget. The Windows build chain (MSVC C++ workload + Windows SDK, UAC-gated
installs) blocked compilation on the dev machine, and for a single-user local
tool the budget argument did not justify the toolchain cost. Rewritten in
Python: Flask (loopback server), pystray (tray), pywin32/psutil (focus + idle
probes), Pillow (tray icon). ~3× faster to iterate, trivially debuggable;
higher RAM is acceptable for one machine. The Rust remnant `apps/desktop/
src-tauri/` is dead and safe to delete.

## Tracking: 1 Hz sampler feeding a pure state machine

`agent/probe.py` reads the foreground window (Win32 `GetForegroundWindow`) and
idle seconds (`GetLastInputInfo`) once per second. `agent/engine.py` is a pure
state machine — classify active/idle, accumulate per `(minute, app)`, flush on
rollover — with no OS or DB access, so the core logic is fully unit-testable.

## Database: SQLite (stdlib `sqlite3`), WAL mode

Embedded, zero-config, offline-first. 1-second samples aggregate to 1-minute
buckets before writing; 90 days of heavy use is ~130k rows. Single connection
behind a thread lock in `agent/store.py`; all SQL lives in that one module.

Two write semantics: `upsert_usage` accumulates (desktop/extension deltas),
`replace_usage` overwrites (Android sends running daily totals against the
midnight bucket — replacing keeps repeated syncs idempotent).

## Dashboard: self-contained HTML, no framework

`dashboard/index.html` and `mobile.html` are single files with inline CSS/JS
(CDN: Google Fonts, qrcodejs). For two pages a bundler adds cost without
benefit. QR generation uses `qrcodejs@1.0.0` (synchronous `new QRCode(div)`)
after `qrcode@1.5.3` failed silently — its `.toCanvas()` is Promise-based and
the rejection was swallowed.

## Browser extension: Chrome MV3, TypeScript + Vite

A service worker tracks the active tab via `tabs`/`windows`/`idle` events
(event-driven — robust to MV3 worker suspension, 1-minute `chrome.alarms`
flush). Tab-session logic is a pure class under Vitest.

## Transport: loopback HTTP with a pairing token

Flask binds strictly to `127.0.0.1:48732`. The extension POSTs minute buckets
(domain only — never full URLs) with a token header. Chosen over native
messaging: no per-browser host registration, identical for Firefox/Edge later,
and it doubled as the ingestion point for mobile sync exactly as planned.

## Mobile: Expo/React Native + EAS cloud builds (switched from Kotlin)

Android usage tracking needs a native app (`UsageStatsManager` +
`PACKAGE_USAGE_STATS`). A Kotlin skeleton came first; replaced by Expo so APKs
build in Expo's cloud (`eas build`) with no local Android Studio — the same
constraint that killed the Rust toolchain. Usage stats via
`@brighthustle/react-native-usage-stats-manager` (note: its native module
returns **seconds**, already divided by 1000). iOS tracking is impossible —
Apple exposes no third-party Screen Time API — so iPhones get the PWA viewer.

## Pairing: QR deep link

The dashboard QR encodes `focuslens://pair?host=…&port=…&token=…` (or
`?url=…` for tunnel). One camera scan opens the Android app with everything
pre-filled. Chosen over manual IP/token entry after exactly one attempt at
typing a token on a phone.

## Remote access: embedded Cloudflare quick tunnel, opt-in

Requirement: phone reaches the desktop from any network with no extra app on
the phone. Tailscale offers better privacy (E2E, P2P) but requires its app on
both devices; a cloud backend breaks local-first entirely. `cloudflared`
quick tunnels are free, need no account, and the binary ships next to the
agent. Off by default, toggled from the tray. Security invariant: requests
with forwarding headers (i.e. via tunnel) must present the pairing token on
every non-public path — enforced in `server.py`, locked by `test_server.py`.

## Packaging: PyInstaller

`focuslens.spec` produces a single windowed `.exe`, bundling the dashboard
HTML and `cloudflared.exe` when present. Landing page (`website/`) deploys to
Netlify as static files — the agent itself never runs in a cloud.

## Repo layout: monorepo

pnpm workspace for TS (extension + shared types), pip for the agent, npm for
Expo (EAS expects its own lockfile — keep `apps/mobile` out of the workspace).
One repo keeps the event schema atomic across producers and consumers.

## Testing: pytest + Vitest

Engine transitions, bucket math, limit thresholds, store semantics
(accumulate vs replace), and the remote token guard under pytest (62 tests);
extension tab-session tracker, offline buffer, and shared utils under Vitest.

## Naming

**FocusLens** is kept — descriptive and unclaimed by major tools.
