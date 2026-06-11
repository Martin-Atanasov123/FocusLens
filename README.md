# FocusLens

Privacy-first, local-only screen time tracker. A Python tray agent records
active-window time on Windows, a Chrome MV3 extension adds per-domain browser
time, and an Android companion app adds phone usage. Everything lands in one
local SQLite database with an HTML dashboard — no cloud, no accounts.

See [TECH_DECISIONS.md](TECH_DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md)
and [CLAUDE.md](CLAUDE.md). Landing page: deployed from `website/` via Netlify.

## Layout

```
apps/desktop      Python agent: tray, 1 Hz sampler, SQLite store, Flask server, dashboard
apps/extension    Chrome MV3 extension (tab tracking, offline buffer, popup)
apps/mobile       Expo/React Native Android app (UsageStatsManager → sync)
packages/shared   Shared TypeScript types + time/domain utilities
website/          Static landing page (Netlify)
```

## Run the desktop agent

Prerequisites: Python 3.11+ on Windows.

```sh
cd apps/desktop
python -m pip install -r requirements.txt
python run.py            # tray icon + dashboard at http://127.0.0.1:48732/
python -m pytest tests/  # 62 tests
```

Package a standalone `.exe`: `pyinstaller focuslens.spec --noconfirm`.

## Browser extension

Prerequisites: Node 20+, pnpm 9 (`npm i -g pnpm`).

```sh
pnpm install
pnpm test                # Vitest: packages/shared + apps/extension
pnpm build:extension     # builds apps/extension/dist — load unpacked in chrome://extensions
```

Pair it: dashboard → Settings → copy the pairing token → extension popup →
paste, Save. The extension sends only hostnames (never full URLs), only to
`127.0.0.1:48732`, and buffers locally while the agent is not running.

## Phone

**View from the phone (no install):** dashboard → Settings → Show QR →
*View (Wi-Fi)* — scan, opens in the browser; add to home screen for a PWA.

**Track phone apps (Android):** build the APK in Expo's cloud — no Android
Studio needed. See [apps/mobile/README.md](apps/mobile/README.md). Pair by
scanning the *Pair app* QR. iOS cannot be tracked (Apple exposes no Screen
Time API); iPhones get the PWA viewer only.

**From any network:** tray → *Remote access (anywhere)* starts an embedded
Cloudflare quick tunnel (`cloudflared.exe` next to the agent). Requests
arriving through the tunnel require the pairing token on every data path.

## Data & privacy

- All data stays in `%LOCALAPPDATA%\FocusLens\focuslens.db` (SQLite, WAL).
- Sources report minute buckets: desktop apps accumulate, Android snapshots
  replace — totals never double-count.
- Soft daily limits notify at 50/80/100%, once per threshold per day.
- Retention sweep deletes rows older than the configured window (default 90d).
- Remote access is opt-in and off by default. No telemetry.
