/**
 * RevenueCat configuration.
 *
 * Dashboard setup checklist:
 *  1. RevenueCat → Project → API Keys → copy the Android public key below.
 *  2. RevenueCat → Products → add "monthly" + "yearly" from Google Play.
 *  3. RevenueCat → Entitlements → create "focuslenz Pro" → attach both products.
 *  4. RevenueCat → Offerings → Default offering → add a Package for each product.
 *  5. RevenueCat → Paywalls → create a paywall on the Default offering
 *     (pick any template — this powers RevenueCatUI.presentPaywall()).
 *
 * Until step 5 the app falls back to the custom PaywallScreen.
 */

/** RevenueCat public Android SDK key (Project → API Keys → Android). */
export const REVENUECAT_ANDROID_KEY = "test_HZKejLZpfRYSXJpMBtCKUOwUFCK";

/** Entitlement identifier — must match exactly what is in RevenueCat dashboard. */
export const ENTITLEMENT_PRO = "focuslenz Pro";

/** Free users get this many blocking events before the paywall appears (aha moment). */
export const FREE_BLOCK_EVENT_LIMIT = 3;

/** Free users may configure at most this many daily limits. */
export const FREE_LIMIT_MAX = 1;

/** True once a real key has been pasted in. */
export function isRevenueCatConfigured(): boolean {
  return (
    REVENUECAT_ANDROID_KEY.length > 10 &&
    !REVENUECAT_ANDROID_KEY.includes("YOUR_KEY")
  );
}
