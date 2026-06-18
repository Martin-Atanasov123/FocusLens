# FocusLens — Android App Blocker

Android screen-time manager that **blocks apps automatically** after a daily limit
and lets you run distraction-free **focus sessions**. Built with Expo/React Native
and a custom Kotlin foreground service.

## What it does

| Feature | How |
|---|---|
| **Daily limits** | Set per-app limits (e.g. TikTok 30 min/day). The app is blocked when the limit is reached. |
| **Focus sessions** | Manually block a chosen set of apps until a fixed deadline. |
| **Always-on service** | `FocusBlockerService` runs as an Android foreground service, checks every 30 s even screen-off. |
| **Block screen** | `BlockActivity` appears full-screen over blocked apps with usage stats and a "go back" option. |
| **Paywall** | First 3 block events are free. Pro (RevenueCat) unlocks unlimited limits and blocks. |
| **Desktop sync** | Optionally syncs today's usage to a FocusLens desktop agent over LAN / Cloudflare tunnel. |

## Source map

```
apps/mobile/
  src/
    App.tsx                       root: onboarding flow, permissions, navigation
    FocusScreen.tsx               start / stop focus sessions
    LimitsScreen.tsx              per-app daily limits UI, Pro upgrade gate
    OnboardingScreen.tsx          3-step setup: permissions + first limit
    PaywallScreen.tsx             fallback paywall (shown when RC paywall fails)
    paywall/
      config.ts                   RC key, entitlement ID, free-tier constants
      purchases.ts                RC SDK wrapper — configurePurchases, presentPaywall, restore…
      useEntitlements.ts          hook: isPro, loading, refresh
    observability.ts              Sentry init (no-op until real DSN is set)
    sync.ts                       UsageStats → POST /events to desktop agent
  modules/focus-blocker/android/…/focusblocker/
    FocusBlockerModule.kt         Expo module bridge (JS ↔ Kotlin)
    FocusBlockerService.kt        foreground service: 1 s tick, limit checks every 30 s
    BlockActivity.kt              full-screen overlay shown over blocked app
    LimitStore.kt                 SharedPreferences: per-app daily limits + joker windows
    BlockStats.kt                 SharedPreferences: block event counter (paywall gate)
    UsageHelper.kt                UsageStatsManager helper (today's per-app seconds)
    BootReceiver.kt               restarts service on boot + MY_PACKAGE_REPLACED
```

## Run on a physical device (USB)

Prerequisites: Node 18+, USB debugging enabled on the phone.

```bash
cd apps/mobile
npm install
npx expo run:android     # compiles + installs debug APK via ADB
```

If you get `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (previous EAS install):

```bash
adb uninstall com.focuslens.mobile
npx expo run:android
```

## Build a cloud APK (EAS, no Android Studio)

```bash
npx eas-cli login        # one-time — free Expo account
npm run build:apk        # preview APK — prints download link + QR (~10–15 min)
```

## Required Android permissions

The user must grant these at first launch (the onboarding screen guides through each):

| Permission | Purpose |
|---|---|
| **Usage access** (Special app access) | Read per-app foreground time |
| **Draw over other apps** | Show block screen over blocked apps |
| **Battery optimization: don't optimize** | Keep service alive in background / Doze |
| **Notifications** | Persistent foreground notification required by Android |

## Testing paywall without Google Play

Two options — no Play Store account needed:

1. **Dev toggle** — tap the FocusLens logo 5 times on the main screen to force `isPro = true` for the session.
2. **RevenueCat dashboard** — in [app.revenuecat.com](https://app.revenuecat.com) find the device and manually grant the `focuslenz Pro` entitlement.

Real payment flow: Install → RevenueCat → Google Play Billing → card charge → RC notifies app.
For sandbox purchases you need a $25 Google Play Console account and a license tester email.

## RevenueCat credentials

| Key | Value |
|---|---|
| Android API key | `test_HZKejLZpfRYSXJpMBtCKUOwUFCK` |
| Entitlement | `focuslenz Pro` |
| Products | `monthly` ($4.99/mo), `yearly` ($39.99/yr) |

The paywall template is configured in the RevenueCat dashboard (AI paywall editor).
To switch to production, replace `REVENUECAT_ANDROID_KEY` in `paywall/config.ts`.

## Sentry crash reporting

`observability.ts` is a no-op until you set a real DSN:

1. Create a project at sentry.io (free tier)
2. Copy DSN from Settings → Client Keys
3. Replace `SENTRY_DSN` in `src/observability.ts`

## Typecheck

```bash
cd apps/mobile
npx tsc --noEmit
```

## Retention loop (product context)

```
Install → grant permissions → set first limit (Onboarding)
  → get blocked → see AHA moment → Paywall (3rd block event)
    → Pro subscription → daily habit → Streaks (Phase 3, pending)
```

North Star: 500 paid users before optimizing anything.
Positioning: "Blocks TikTok after 30 minutes. Automatically."
