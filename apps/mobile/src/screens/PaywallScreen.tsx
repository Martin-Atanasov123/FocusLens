import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PACKAGE_TYPE, type PurchasesPackage } from "react-native-purchases";

import { C } from "../theme";
import { fetchPackages, purchase, restore } from "../paywall/purchases";

const PRO_PERKS = [
  "Unlimited daily app limits",
  "Unlimited focus-session profiles",
  "Desktop + cross-device sync",
  "Early access to streaks & categories",
];

function periodLabel(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case PACKAGE_TYPE.ANNUAL:
      return "Yearly";
    case PACKAGE_TYPE.MONTHLY:
      return "Monthly";
    case PACKAGE_TYPE.WEEKLY:
      return "Weekly";
    case PACKAGE_TYPE.LIFETIME:
      return "Lifetime";
    default:
      return pkg.product.title;
  }
}

/** "~$3.33/mo" for an annual plan, else "". */
function perMonthHint(pkg: PurchasesPackage): string {
  if (pkg.packageType !== PACKAGE_TYPE.ANNUAL || !pkg.product.price) return "";
  const perMonth = pkg.product.price / 12;
  const currency = pkg.product.priceString.replace(/[\d.,\s]/g, "") || "$";
  return `≈ ${currency}${perMonth.toFixed(2)}/mo`;
}

export default function PaywallScreen({
  visible,
  onClose,
  onPurchased,
  headline = "Make it stick — go Pro",
  subhead = "You've hit your limit a few times. Unlock everything FocusLens can do.",
}: {
  visible: boolean;
  onClose: () => void;
  onPurchased?: () => void;
  headline?: string;
  subhead?: string;
}) {
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Downsell step (Opal-style): first close attempt on the annual plan offers
  // the monthly plan once before actually closing.
  const [downsell, setDownsell] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    setDownsell(false);
    (async () => {
      const pkgs = await fetchPackages();
      setPackages(pkgs);
      // Pre-select annual (best value) if present, else the first package.
      const annual = pkgs.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL);
      setSelected(annual?.identifier ?? pkgs[0]?.identifier ?? null);
      setLoading(false);
    })();
  }, [visible]);

  const selectedPkg = useMemo(
    () => packages.find((p) => p.identifier === selected) ?? null,
    [packages, selected]
  );

  const doPurchase = async () => {
    if (!selectedPkg || busy) return;
    setBusy(true);
    setError(null);
    const res = await purchase(selectedPkg);
    setBusy(false);
    if (res.ok) {
      onPurchased?.();
      onClose();
    } else if (!res.cancelled) {
      setError(res.message);
    }
  };

  const monthlyPkg = useMemo(
    () => packages.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY) ?? null,
    [packages]
  );

  /** Close request: intercept once with the monthly downsell when relevant. */
  const requestClose = () => {
    const annualSelected = selectedPkg?.packageType === PACKAGE_TYPE.ANNUAL;
    if (!downsell && annualSelected && monthlyPkg) {
      setDownsell(true);
      setSelected(monthlyPkg.identifier);
      return;
    }
    onClose();
  };

  const doRestore = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const pro = await restore();
    setBusy(false);
    if (pro) {
      onPurchased?.();
      onClose();
    } else {
      setError("No previous purchase found.");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose}>
      <View style={s.root}>
        <Pressable style={s.close} onPress={requestClose} hitSlop={12}>
          <Text style={s.closeText}>✕</Text>
        </Pressable>

        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.eyebrow}>FOCUSLENS PRO</Text>
          <Text style={s.headline}>
            {downsell ? "Not ready for a year?" : headline}
          </Text>
          <Text style={s.subhead}>
            {downsell ? "We get it. Try a monthly plan instead." : subhead}
          </Text>

          {!downsell && (
            <View style={s.perks}>
              {PRO_PERKS.map((perk) => (
                <View key={perk} style={s.perkRow}>
                  <Text style={s.perkCheck}>✓</Text>
                  <Text style={s.perkText}>{perk}</Text>
                </View>
              ))}
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={C.amber} style={{ marginVertical: 40 }} />
          ) : packages.length === 0 ? (
            <View style={s.unavailable}>
              <Text style={s.unavailableText}>
                Subscriptions aren't available yet. Billing setup is the last
                step before launch.
              </Text>
            </View>
          ) : (
            <>
              <View style={s.plans}>
                {(downsell && monthlyPkg ? [monthlyPkg] : packages).map((pkg) => {
                  const on = pkg.identifier === selected;
                  const isAnnual = pkg.packageType === PACKAGE_TYPE.ANNUAL;
                  const hint = perMonthHint(pkg);
                  return (
                    <Pressable
                      key={pkg.identifier}
                      style={[s.plan, on && s.planOn]}
                      onPress={() => setSelected(pkg.identifier)}
                    >
                      {isAnnual && (
                        <View style={s.bestBadge}>
                          <Text style={s.bestBadgeText}>BEST VALUE</Text>
                        </View>
                      )}
                      <View style={s.planLeft}>
                        <View style={[s.radio, on && s.radioOn]}>
                          {on && <View style={s.radioDot} />}
                        </View>
                        <View>
                          <Text style={s.planPeriod}>{periodLabel(pkg)}</Text>
                          {!!hint && <Text style={s.planHint}>{hint}</Text>}
                        </View>
                      </View>
                      <Text style={s.planPrice}>{pkg.product.priceString}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {error && <Text style={s.error}>{error}</Text>}

              <Pressable
                style={[s.cta, busy && s.ctaBusy]}
                onPress={doPurchase}
                disabled={busy || !selectedPkg}
              >
                <Text style={s.ctaText}>
                  {busy ? "Processing…" : "Continue"}
                </Text>
              </Pressable>

              {downsell && (
                <Pressable onPress={onClose} disabled={busy} style={s.restore}>
                  <Text style={s.restoreText}>No thanks →</Text>
                </Pressable>
              )}

              <Pressable onPress={doRestore} disabled={busy} style={s.restore}>
                <Text style={s.restoreText}>Restore purchases</Text>
              </Pressable>

              <Text style={s.fine}>
                Subscription renews automatically until cancelled. Manage or
                cancel anytime in Google Play.
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  close: { position: "absolute", top: 52, right: 20, zIndex: 10, padding: 6 },
  closeText: { fontSize: 22, color: C.ink3, fontWeight: "300" },

  content: { paddingTop: 92, paddingHorizontal: 26, paddingBottom: 48 },

  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: C.amber,
    fontWeight: "700",
    marginBottom: 10,
  },
  headline: {
    fontSize: 30,
    fontWeight: "800",
    color: C.ink,
    lineHeight: 36,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  subhead: { fontSize: 15, color: C.ink2, lineHeight: 22, marginBottom: 28 },

  // perks
  perks: { marginBottom: 30, gap: 12 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  perkCheck: {
    color: C.green,
    fontSize: 16,
    fontWeight: "800",
    width: 18,
  },
  perkText: { fontSize: 15, color: C.ink, flex: 1 },

  // plan cards
  plans: { gap: 12, marginBottom: 20 },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.glass,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: C.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  planOn: { borderColor: C.amber, backgroundColor: C.glowFaint },
  planLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.ink3,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: C.amber },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.amber },
  planPeriod: { fontSize: 16, fontWeight: "700", color: C.ink },
  planHint: { fontSize: 12.5, color: C.ink2, marginTop: 2 },
  planPrice: {
    fontSize: 17,
    fontWeight: "700",
    color: C.ink,
    fontVariant: ["tabular-nums"],
  },
  bestBadge: {
    position: "absolute",
    top: -9,
    right: 14,
    backgroundColor: C.amber,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  bestBadgeText: {
    color: C.onAccent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  // cta
  cta: {
    backgroundColor: C.amber,
    paddingVertical: 17,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 4,
    shadowColor: C.amber,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { color: C.onAccent, fontSize: 17, fontWeight: "700" },
  restore: { paddingVertical: 14, alignItems: "center" },
  restoreText: { color: C.ink2, fontSize: 14, fontWeight: "500" },
  fine: {
    fontSize: 11,
    color: C.ink3,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 4,
  },
  error: {
    color: C.red,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },

  // unavailable state
  unavailable: {
    backgroundColor: C.glass,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginVertical: 16,
  },
  unavailableText: {
    fontSize: 14,
    color: C.ink2,
    lineHeight: 21,
    textAlign: "center",
  },
});
