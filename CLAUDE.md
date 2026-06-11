# CLAUDE.md

## Project Overview

FocusLens is a privacy-first, local-only screen time tracker for a single user.
A Python tray agent records active-window time on Windows, a Chrome extension
adds per-domain browser time, and an Expo Android app adds phone app usage.
Everything aggregates into one local SQLite database served by a loopback Flask
server with an HTML dashboard — no cloud, no accounts. Remote phone access is
an opt-in Cloudflare quick tunnel. A static landing page deploys to Netlify.

## Tech Stack

- Desktop agent: Python 3 — Flask, pystray, pywin32, psutil, SQLite (WAL)
- Dashboard: vanilla HTML/CSS/JS, single files (no framework, no build step)
- Browser extension: Chrome MV3, TypeScript, Vite, Vitest (pnpm workspace)
- Mobile: Expo / React Native (Android only), EAS cloud builds, npm
- Packaging: PyInstaller (`focuslens.spec`); remote access via `cloudflared`
- Hosting: Netlify, static only, publishes `website/`

## Build, Dev & Test Commands

```bash
# Desktop agent (primary component)
cd apps/desktop
python -m pip install -r requirements.txt
python run.py                  # tray + dashboard at http://127.0.0.1:48732/
python -m pytest tests/ -q     # 62 tests

# Extension + shared TS (pnpm workspace, run from repo root)
pnpm install
pnpm test                      # Vitest: packages/shared + apps/extension
pnpm build:extension           # outputs apps/extension/dist — load unpacked

# Mobile (npm, NOT pnpm)
cd apps/mobile
npm install
npx tsc --noEmit               # typecheck
npx eas-cli build -p android --profile preview   # cloud APK (needs login)

# Windows .exe
cd apps/desktop && pyinstaller focuslens.spec --noconfirm
```

No linter is configured in any package.

## Architecture & Key Files

```
apps/desktop/
  run.py               entry point: wires store, Flask thread, sampler, tray
  agent/engine.py      pure state machine: 1 Hz samples → minute buckets
  agent/sampler.py     1 Hz loop, idle detection, hourly retention sweep
  agent/probe.py       Windows-only: active window + idle seconds (win32)
  agent/store.py       SQLite layer, thread-locked; all SQL lives here
  agent/server.py      Flask routes; remote-token guard for tunnel requests
  agent/limits.py      soft-limit thresholds (50/80/100%), notification dedup
  agent/tunnel.py      cloudflared subprocess wrapper (opt-in, tray-toggled)
  dashboard/index.html desktop dashboard (self-contained, CDN qrcodejs)
  dashboard/mobile.html phone view, PWA-capable; token-from-URL for tunnel
apps/extension/src/    tracker.ts (tab sessions), transport.ts (buffer+POST)
apps/mobile/src/       sync.ts (UsageStats → POST /events), App.tsx (setup UI)
packages/shared/src/   TS types + time/domain utils shared with extension
website/index.html     Netlify landing page (static, self-contained)
```

Data flow: sources POST minute buckets to Flask `/events`; dashboard reads
`/api/summary`. Desktop writes accumulate (`upsert_usage`); Android snapshots
replace (`replace_usage`, midnight bucket) so repeated syncs never double-count.

## Data Model

SQLite at `%LOCALAPPDATA%/FocusLens/focuslens.db`, schema in `store.py`:

- `usage_minutes(bucket_ts, source, kind, key, label, active_secs, idle_secs)`
  — PK `(bucket_ts, source, kind, key)` WITHOUT ROWID. source: desktop |
  extension | android; kind: app | domain. bucket_ts is unix, minute-aligned.
- `limits(id, target_kind, target_key, period, limit_secs, limit_type, enabled)`
- `reminder_log(limit_id, date, threshold_pct)` — dedups limit notifications
- `settings(key, value)` — pairing_token, retention_days, idle_threshold_secs

## Environment Variables

None. Configuration lives in the `settings` table; the data dir derives from
`LOCALAPPDATA` (Windows) or `~/.local/share` (other). Port 48732 is a constant
(`PORT` in run.py, mirrored in extension transport and dashboard).

## Code Style & Conventions

- Dashboard/website HTML files are intentionally self-contained (inline CSS/JS,
  Google Fonts + qrcodejs via CDN). Do not introduce a bundler for them.
- Design tokens: warm cream palette (`--bg:#F2EDE3`, `--amber:#B26A0A`),
  Fraunces (display numbers), DM Mono (data), Figtree (UI). Reuse in new UI.
- Engine/limits logic stays pure (no I/O) so it is unit-testable; I/O belongs
  in sampler/server/store.
- All timestamps are unix seconds aligned to minute buckets (`ts % 60 == 0`);
  server validates this on ingest.
- API JSON uses camelCase (`pairingToken`, `activeSecs`); SQL and Python use
  snake_case. Extension payload keys: `domain`/`activeSecs`/`bucketTs`;
  android payload: `key`/`active_secs`/`bucket_ts` (legacy mismatch — keep).
- Security invariant: local loopback requests need no token; any request with
  forwarding headers (tunnel) must carry `x-focuslens-token` on non-public
  paths. Never weaken `_guard_remote` in server.py; test_server.py locks it.
- Mobile uses npm + package-lock.json; the pnpm workspace must not include it.

## Out of Bounds

- `apps/desktop/cloudflared.exe` — downloaded binary, gitignored
- `apps/extension/dist/`, `node_modules/`, `__pycache__/`, `.expo/` — generated
- `pnpm-lock.yaml`, `apps/mobile/package-lock.json` — regenerate, never hand-edit

## Active Context

- EAS Android build is ready but blocked on the user's Expo login
  (`npx eas-cli login`, then `npm run build:apk` in apps/mobile).
- `qrcode@1.5.3` was replaced by synchronous `qrcodejs@1.0.0` after the async
  `.toCanvas()` silently failed; QR target is a `<div>`, not `<canvas>`.
- iOS tracking is impossible (no public Screen Time API); the iPhone story is
  the PWA dashboard viewer only.
