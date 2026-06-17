/**
 * RevenueCat configuration.
 *
 * To go live:
 *   1. Create a project at https://app.revenuecat.com
 *   2. Add the Google Play app, paste the Android API key below (starts "goog_")
 *   3. Create an entitlement called "pro" and attach your monthly + annual
 *      products to an offering (default offering is used automatically).
 *
 * Until a real key is set, billing is disabled: `isPro` stays false and the
 * paywall renders a "not available yet" state instead of crashing. This mirrors
 * the EAS-build-blocked-on-login pattern — the code is complete, only the
 * external account setup remains.
 */

/** RevenueCat public Android SDK key (Project → API Keys → Google). */
export const REVENUECAT_ANDROID_KEY = "goog_YOUR_KEY_HERE";

/** Entitlement identifier configured in the RevenueCat dashboard. */
export const ENTITLEMENT_PRO = "pro";

/** Free users get this many blocking events before the paywall appears. */
export const FREE_BLOCK_EVENT_LIMIT = 3;

/** Free users may configure at most this many daily limits. */
export const FREE_LIMIT_MAX = 1;

/** True once a real key has been pasted in (not the placeholder). */
export function isRevenueCatConfigured(): boolean {
  return (
    REVENUECAT_ANDROID_KEY.startsWith("goog_") &&
    !REVENUECAT_ANDROID_KEY.includes("YOUR_KEY")
  );
}
