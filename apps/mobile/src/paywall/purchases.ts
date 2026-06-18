/**
 * Thin, crash-proof wrapper around the RevenueCat SDK.
 *
 * Every call is guarded so the app keeps working when:
 *   - running in Expo Go (native module absent), or
 *   - no API key is configured yet (see config.ts).
 *
 * Higher layers (useEntitlements, App.tsx) never touch Purchases directly —
 * they go through these functions and treat failures as "free / no billing".
 *
 * Paywall & Customer Center use react-native-purchases-ui which presents
 * native modal screens managed entirely by RevenueCat.
 */
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesPackage,
} from "react-native-purchases";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";

import {
  ENTITLEMENT_PRO,
  REVENUECAT_ANDROID_KEY,
  isRevenueCatConfigured,
} from "./config";

let configured = false;

// ── Core SDK ────────────────────────────────────────────────────────────────

/** Configure RevenueCat once. No-op without a real key or native module. */
export function configurePurchases(): void {
  if (configured || !isRevenueCatConfigured()) return;
  try {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY });
    configured = true;
  } catch {
    /* native module unavailable */
  }
}

/** True if customerInfo carries an active Pro entitlement. */
export function hasProEntitlement(info: CustomerInfo | null | undefined): boolean {
  return !!info?.entitlements.active[ENTITLEMENT_PRO];
}

/** Current Pro status. Returns false if billing is unavailable. */
export async function fetchIsPro(): Promise<boolean> {
  if (!isRevenueCatConfigured()) return false;
  try {
    configurePurchases();
    const info = await Purchases.getCustomerInfo();
    return hasProEntitlement(info);
  } catch {
    return false;
  }
}

/** Available packages from the current offering. Empty if none / unavailable. */
export async function fetchPackages(): Promise<PurchasesPackage[]> {
  if (!isRevenueCatConfigured()) return [];
  try {
    configurePurchases();
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

export type PurchaseResult =
  | { ok: true; isPro: boolean }
  | { ok: false; cancelled: boolean; message: string };

/** Buy a specific package (used by the custom fallback PaywallScreen). */
export async function purchase(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!isRevenueCatConfigured()) {
    return { ok: false, cancelled: false, message: "Billing isn't set up yet." };
  }
  try {
    configurePurchases();
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, isPro: hasProEntitlement(customerInfo) };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, cancelled: true, message: "" };
    return {
      ok: false,
      cancelled: false,
      message: e?.message ?? "Purchase failed. Please try again.",
    };
  }
}

/** Restore prior purchases. Returns the resulting Pro status. */
export async function restore(): Promise<boolean> {
  if (!isRevenueCatConfigured()) return false;
  try {
    configurePurchases();
    const info = await Purchases.restorePurchases();
    return hasProEntitlement(info);
  } catch {
    return false;
  }
}

/** Subscribe to entitlement changes. Returns an unsubscribe function. */
export function addProListener(cb: (isPro: boolean) => void): () => void {
  if (!isRevenueCatConfigured()) return () => {};
  try {
    configurePurchases();
    const listener = (info: CustomerInfo) => cb(hasProEntitlement(info));
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      try { Purchases.removeCustomerInfoUpdateListener(listener); } catch {}
    };
  } catch {
    return () => {};
  }
}

// ── RevenueCat UI ────────────────────────────────────────────────────────────

export type PaywallResult = {
  /** True when a purchase or restore completed successfully. */
  purchased: boolean;
  /** True when the user actively dismissed without buying. */
  cancelled: boolean;
  /**
   * True when the RC paywall couldn't be shown (not configured in dashboard yet).
   * Caller should fall back to the custom PaywallScreen in this case.
   */
  error: boolean;
};

/**
 * Present the paywall configured in the RevenueCat dashboard.
 * Requires a Paywall template to be set up on the Default offering.
 * Returns `error: true` if the paywall isn't configured yet — caller falls back.
 */
export async function presentPaywall(): Promise<PaywallResult> {
  if (!isRevenueCatConfigured()) {
    return { purchased: false, cancelled: false, error: true };
  }
  try {
    configurePurchases();
    const result = await RevenueCatUI.presentPaywall();
    return {
      purchased: result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED,
      cancelled: result === PAYWALL_RESULT.CANCELLED,
      error: result === PAYWALL_RESULT.ERROR,
    };
  } catch {
    return { purchased: false, cancelled: false, error: true };
  }
}

/**
 * Present the paywall only when the user does NOT already have Pro.
 * Returns `{ purchased: false, error: false }` silently when they're already Pro.
 */
export async function presentPaywallIfNeeded(): Promise<PaywallResult> {
  if (!isRevenueCatConfigured()) {
    return { purchased: false, cancelled: false, error: true };
  }
  try {
    configurePurchases();
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: ENTITLEMENT_PRO,
    });
    return {
      purchased: result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED,
      cancelled: result === PAYWALL_RESULT.CANCELLED,
      error: result === PAYWALL_RESULT.ERROR,
    };
  } catch {
    return { purchased: false, cancelled: false, error: true };
  }
}

/**
 * Present the RevenueCat Customer Center — lets users manage, cancel, or get
 * support for their subscription without contacting you directly.
 */
export async function presentCustomerCenter(): Promise<void> {
  if (!isRevenueCatConfigured()) return;
  try {
    configurePurchases();
    await RevenueCatUI.presentCustomerCenter();
  } catch {}
}
