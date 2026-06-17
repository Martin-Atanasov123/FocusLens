/**
 * React hook exposing the user's Pro status.
 *
 * Configures RevenueCat on first mount, fetches the current entitlement, and
 * keeps it live via a customer-info listener. Always returns a usable value —
 * `isPro` is false whenever billing is unavailable.
 */
import { useCallback, useEffect, useState } from "react";

import { addProListener, configurePurchases, fetchIsPro } from "./purchases";

export interface Entitlements {
  /** True while the active "pro" entitlement is present. */
  isPro: boolean;
  /** True until the first entitlement check resolves. */
  loading: boolean;
  /** Re-fetch Pro status on demand (e.g. after returning from the store). */
  refresh: () => Promise<void>;
}

export function useEntitlements(): Entitlements {
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const pro = await fetchIsPro();
    setIsPro(pro);
  }, []);

  useEffect(() => {
    let alive = true;
    configurePurchases();
    (async () => {
      const pro = await fetchIsPro();
      if (!alive) return;
      setIsPro(pro);
      setLoading(false);
    })();
    const unsubscribe = addProListener((pro) => {
      if (alive) setIsPro(pro);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { isPro, loading, refresh };
}
