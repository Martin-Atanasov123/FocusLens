# CLAUDE.md

## Project Overview

FocusLens has two distinct products sharing one repo:

1. **Desktop + extension tracker** — privacy-first, local-only. A Python tray
   agent records active-window time on Windows; a Chrome MV3 extension adds
   per-domain browser time. Everything aggregates into one local SQLite database
   served by a loopback Flask server with an HTML dashboard — no cloud, no
   accounts. Remote access is an opt-in Cloudflare quick tunnel.

2. **Android consumer app** — standalone premium screen-time blocker. An
   always-on Kotlin foreground service (`FocusBlockerService`) blocks apps after
   configurable daily limits and during manual focus sessions. Onboarding, a
   RevenueCat paywall, and Sentry crash reporting are already integrated.
   Optionally syncs usage to the desktop agent over LAN.

## Tech Stack

- Desktop agent: Python 3 — Flask, pystray, pywin32, psutil, SQLite (WAL)
- Dashboard: vanilla HTML/CSS/JS, single files (no framework, no build step)
- Browser extension: Chrome MV3, TypeScript, Vite, Vitest (pnpm workspace)
- Mobile: Expo / React Native (Android only), EAS cloud builds, npm;
  custom Kotlin native module (foreground service, overlay activity);
  RevenueCat (`react-native-purchases` v10 + `react-native-purchases-ui` v10);
  Sentry (`@sentry/react-native`)
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
apps/mobile/src/
  App.tsx              root: onboarding, permission gates, navigation
  FocusScreen.tsx      start/stop focus sessions
  LimitsScreen.tsx     per-app daily limits, Pro upgrade gate
  OnboardingScreen.tsx 3-step setup: permissions + first limit
  PaywallScreen.tsx    fallback paywall (when RC paywall fails)
  paywall/config.ts    RC key, entitlement, free-tier thresholds
  paywall/purchases.ts RC wrapper: configurePurchases, presentPaywall, restore
  paywall/useEntitlements.ts  hook: isPro, loading, refresh
  observability.ts     Sentry init (no-op until DSN set)
  sync.ts              UsageStats → POST /events (desktop agent sync)
apps/mobile/modules/focus-blocker/android/…/focusblocker/
  FocusBlockerModule.kt   Expo bridge (JS ↔ Kotlin)
  FocusBlockerService.kt  foreground service: 1 s tick, limit checks every 30 s
  BlockActivity.kt        full-screen overlay over blocked apps
  LimitStore.kt           SharedPreferences: per-app daily limits + joker windows
  BlockStats.kt           SharedPreferences: block event counter (paywall gate)
  UsageHelper.kt          UsageStatsManager: today's per-app seconds
  BootReceiver.kt         restart service on boot + MY_PACKAGE_REPLACED
packages/shared/src/   TS types + time/domain utils shared with extension
website/index.html     Netlify landing page (static, self-contained)
```

Desktop data flow: sources POST minute buckets to Flask `/events`; dashboard
reads `/api/summary`. Desktop writes accumulate (`upsert_usage`); Android
snapshots replace (`replace_usage`, midnight bucket) so repeated syncs
never double-count.

Android blocking flow: `FocusBlockerService` ticks every second, reads
foreground app via `UsageStatsManager`, compares to `LimitStore`, launches
`BlockActivity` as a full-screen overlay when a limit is exceeded. Block count
in `BlockStats` gates the free tier (3 events → paywall).

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

- **Android app is in active development** as a consumer blocker. Core blocking
  (FocusBlockerService + BlockActivity), daily limits, onboarding, and a
  RevenueCat paywall are all implemented.
- **RevenueCat** test key: `test_HZKejLZpfRYSXJpMBtCKUOwUFCK`; entitlement:
  `focuslenz Pro`. Dashboard still needs: Products (monthly/yearly), Entitlement
  wired to Default Offering, and a Paywall template created (AI paywall editor).
  Until done, `presentPaywall()` returns `error: true` and the app falls back to
  the custom `PaywallScreen`.
- **Testing paywall** without Google Play: 5-tap dev toggle on the logo forces
  `isPro = true`; or manually grant entitlement from the RevenueCat dashboard.
- **Sentry** DSN placeholder in `src/observability.ts` — replace with a real DSN
  to activate crash reporting.
- **USB install** — if a previous EAS-signed build is on the phone, run
  `adb uninstall com.focuslens.mobile` before `npx expo run:android`.
- **Next phases (plan):** Phase 3 — Streaks (daily habit, D30 retention);
  Phase 5 — Scheduled blocks (Pro: block Instagram 9–18 on weekdays);
  Phase 7 — Play Store listing ($25 Google Play Console).
- `qrcode@1.5.3` was replaced by synchronous `qrcodejs@1.0.0` (desktop
  dashboard); QR target is a `<div>`, not `<canvas>`.
- iOS: Apple exposes no third-party Screen Time API; iPhones get the PWA
  dashboard viewer only.
