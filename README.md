# FocusLens

Privacy-first, local-only screen time tracker. Desktop agent + dashboard (Tauri 2, Rust + Svelte)
and a Chrome MV3 extension for per-tab tracking. All data stays in a local SQLite database;
the extension talks only to `127.0.0.1`.

See [TECH_DECISIONS.md](TECH_DECISIONS.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Layout

```
apps/desktop      Tauri app: tray agent, SQLite store, loopback server, Svelte dashboard
apps/extension    Chrome MV3 extension (tab tracking, offline buffer, popup)
packages/shared   Shared TypeScript types + time/domain utilities
```

## Prerequisites

- Node 20+, pnpm 9 (`npm i -g pnpm`)
- Rust stable (MSVC toolchain on Windows) — https://rustup.rs
- Windows: Visual Studio C++ Build Tools + Windows SDK. macOS: Xcode Command Line Tools.

## Develop

```sh
pnpm install
pnpm test                # Vitest (shared + extension) — Rust tests: cd apps/desktop/src-tauri && cargo test
pnpm dev:desktop         # runs the Tauri app (tray + dashboard)
pnpm build:extension     # builds apps/extension/dist — load unpacked in chrome://extensions
```

## Pairing the extension

1. Run the desktop app; open Settings in the dashboard and copy the pairing token.
2. Click the FocusLens extension icon, paste the token, Save. The popup shows connection status.

The extension sends only hostnames (never full URLs), only to `127.0.0.1:48732`, and buffers
locally while the desktop app is not running.

## Data & privacy

- SQLite database in the per-user app data dir (`focuslens.db`), WAL mode.
- 1-second sampling aggregated to 1-minute buckets; default retention 90 days (daily sweep).
- No network access except the loopback listener. No telemetry.

## Phase 1 scope

Windows + macOS agent (macOS code paths are compile-gated; developed and tested on Windows),
Chrome extension, daily dashboard view (per-app + per-domain), soft daily limits with
50/80/100% system-notification reminders.
