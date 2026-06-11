# FocusLens Mobile (Android)

Expo/React Native companion app. Tracks **all app usage** on the phone via
Android's `UsageStatsManager` and syncs it to the desktop agent — over LAN or
through the Cloudflare tunnel ("Remote access (anywhere)").

iOS is not supported for tracking: Apple does not expose Screen Time data to
third-party apps.

## Build an APK (no Android Studio needed)

Builds run in Expo's cloud (EAS). One-time setup:

```bash
cd apps/mobile
npm install
npx eas-cli login          # free account — sign up at https://expo.dev
```

Then build:

```bash
npx eas-cli build -p android --profile preview
```

When it finishes (~10–15 min) EAS prints a link + QR code. Open it on the
phone, download the APK, install (allow "unknown sources" if asked).

## Pairing

1. Desktop dashboard → Settings → **Show QR** → tab **"Pair app"**
2. Scan with the phone camera — the app opens with connection + token filled
3. Grant **Usage access** when prompted (Settings → enable FocusLens)
4. Tap **Sync now** — phone apps appear in the desktop dashboard

If "Remote access (anywhere)" is enabled on the desktop, the pair QR encodes
the tunnel URL automatically and syncing works from any network.

## How syncing works

- Foreground: "Sync now" button
- Background: OS-scheduled task every ~15 min (`expo-background-fetch`)
- Payload: snapshot of today's per-app totals against the midnight bucket;
  the agent **replaces** that row each sync, so totals never double-count
