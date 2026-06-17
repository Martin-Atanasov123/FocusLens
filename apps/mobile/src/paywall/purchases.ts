/**
 * Thin, crash-proof wrapper around the RevenueCat SDK.
 *
 * Every call is guarded so the app keeps working when:
 *   - running in Expo Go (native module absent), or
 *   - no API key is configured yet (see config.ts).
 *
 * Higher layers (useEntitlements, PaywallScreen) never touch `Purchases`
 * directly — they go through these functions and treat failures as "free / no
 * billing available".
 */
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesPackage,
} from "react-native-purchases";

import {
  ENTITLEMENT_PRO,
  REVENUECAT_ANDROID_KEY,
  isRevenueCatConfigured,
} from "./config";

let configured = false;

/** Configure RevenueCat once. No-op without a real key or native module. */
export function configurePurchases(): void {
  if (configured || !isRevenueCatConfigured()) return;
  try {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY });
    configured = true;
  } catch {
    /* native module unavailable — stay unconfigured */
  }
}

/** True if `customerInfo` carries an active "pro" entitlement. */
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

/** Buy a package. Distinguishes user-cancel from real errors. */
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
      try {
        Purchases.removeCustomerInfoUpdateListener(listener);
      } catch {}
    };
  } catch {
    return () => {};
  }
}
