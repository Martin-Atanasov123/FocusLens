import React, { useEffect, useState } from "react";
import {
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";

import { C } from "../theme";
import { canDrawOverlays, requestOverlayPermission } from "../blocking/FocusBlocker";
import { hasUsagePermission, openUsageAccessSettings } from "../sync";

type Step = 1 | 2 | 3;

const POPULAR_APPS = [
  "TikTok 🎵",
  "Instagram 📸",
  "YouTube ▶️",
  "X / Twitter 𝕏",
  "Facebook 👥",
  "Snapchat 👻",
  "Reddit 🤖",
  "WhatsApp 💬",
  "Netflix 🎬",
  "Shorts / Reels ⚡",
  "Games 🎮",
  "News / Browser 📰",
];

export default function OnboardingScreen({
  onComplete,
}: {
  /** Called with the user's (possibly empty) first name. */
  onComplete: (name: string) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [usageGranted, setUsageGranted] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);

  // Enter step 3: check overlay + notification immediately
  useEffect(() => {
    if (step !== 3) return;
    setOverlayGranted(canDrawOverlays());
    // POST_NOTIFICATIONS only exists on Android 13+ (API 33)
    if (Platform.OS === "android" && Platform.Version >= 33) {
      PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      ).then(setNotifGranted);
    } else {
      setNotifGranted(true); // older Android: always allowed
    }
  }, [step]);

  const requestNotifPermission = async () => {
    if (Platform.OS !== "android" || Platform.Version < 33) {
      setNotifGranted(true);
      return;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    setNotifGranted(result === PermissionsAndroid.RESULTS.GRANTED);
  };

  // Steps 2 & 3: detect return from system settings
  useEffect(() => {
    if (step !== 2 && step !== 3) return;
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      if (step === 2) {
        const ok = await hasUsagePermission();
        setUsageGranted(ok);
      } else {
        setOverlayGranted(canDrawOverlays());
      }
    });
    return () => sub.remove();
  }, [step]);

  const toggle = (label: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  const exemptBattery = async () => {
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
        { data: `package:${Application.applicationId}` }
      );
    } catch {
      // fallback: open the general battery optimization list
      try {
        await IntentLauncher.startActivityAsync(
          "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"
        );
      } catch {}
    }
  };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Logo */}
      <Text style={s.logo}>
        Focus<Text style={s.logoEm}>Lens</Text>
      </Text>

      {/* Step dots */}
      <View style={s.dots}>
        {([1, 2, 3] as Step[]).map((n) => (
          <View
            key={n}
            style={[s.dot, step > n && s.dotDone, step === n && s.dotActive]}
          />
        ))}
      </View>

      {/* ── Step 1: motivation capture ── */}
      {step === 1 && (
        <>
          <Text style={s.head}>What pulls you in too much? 📱</Text>
          <Text style={s.sub}>
            Pick the apps you want to spend less time on.
          </Text>
          <TextInput
            style={s.nameInput}
            placeholder="Your first name (optional)"
            placeholderTextColor={C.ink3}
            value={name}
            onChangeText={setName}
            maxLength={24}
            autoCapitalize="words"
            returnKeyType="done"
          />
          <View style={s.grid}>
            {POPULAR_APPS.map((label) => {
              const on = picked.has(label);
              return (
                <Pressable
                  key={label}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => toggle(label)}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[s.btn, picked.size === 0 && s.btnOff]}
            onPress={() => picked.size > 0 && setStep(2)}
          >
            <Text style={[s.btnText, picked.size === 0 && s.btnOffText]}>
              Continue →
            </Text>
          </Pressable>
        </>
      )}

      {/* ── Step 2: usage access ── */}
      {step === 2 && (
        <>
          <Text style={s.head}>See your real screen time</Text>
          <Text style={s.sub}>
            FocusLens reads how long you use each app — the same data Android's
            own Digital Wellbeing uses. Everything stays on your phone.
          </Text>

          <View style={s.card}>
            <Text style={s.cardLabel}>USAGE ACCESS</Text>
            <Text style={s.cardBody}>
              Find FocusLens in the list and flip the toggle on.
            </Text>
            {usageGranted ? (
              <View style={s.grantedRow}>
                <Text style={s.grantedText}>✓  Granted</Text>
              </View>
            ) : (
              <Pressable
                style={s.btn}
                onPress={() => openUsageAccessSettings().catch(() => {})}
              >
                <Text style={s.btnText}>Open Usage Access settings →</Text>
              </Pressable>
            )}
          </View>

          <Pressable
            style={usageGranted ? s.btn : s.btnGhost}
            onPress={() => setStep(3)}
          >
            <Text style={usageGranted ? s.btnText : s.btnGhostText}>
              {usageGranted ? "Continue →" : "Skip for now"}
            </Text>
          </Pressable>
          {!usageGranted && (
            <Text style={s.warn}>
              Without this, FocusLens can't show your screen time.
            </Text>
          )}
        </>
      )}

      {/* ── Step 3: overlay + battery ── */}
      {step === 3 && (
        <>
          <Text style={s.head}>Make limits stick 🛡️</Text>
          <Text style={s.sub}>
            Three permissions let FocusLens send alerts, show the block screen,
            and keep running when your phone is locked. You can grant these later
            in Settings if needed.
          </Text>

          <View style={s.card}>
            <View style={s.permRow}>
              <View style={s.permInfo}>
                <Text style={s.cardLabel}>NOTIFICATIONS</Text>
                <Text style={s.cardBody}>
                  Shows the persistent "monitoring active" status and alerts
                  when you're close to a daily limit.
                </Text>
              </View>
              {notifGranted ? (
                <Text style={s.grantedBadge}>✓</Text>
              ) : (
                <Pressable style={s.permBtn} onPress={requestNotifPermission}>
                  <Text style={s.permBtnText}>Allow</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={s.card}>
            <View style={s.permRow}>
              <View style={s.permInfo}>
                <Text style={s.cardLabel}>DISPLAY OVER OTHER APPS</Text>
                <Text style={s.cardBody}>
                  Shows the limit screen when you exceed your daily cap.
                </Text>
              </View>
              {overlayGranted ? (
                <Text style={s.grantedBadge}>✓</Text>
              ) : (
                <Pressable style={s.permBtn} onPress={requestOverlayPermission}>
                  <Text style={s.permBtnText}>Allow</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={s.card}>
            <View style={s.permRow}>
              <View style={s.permInfo}>
                <Text style={s.cardLabel}>BATTERY OPTIMIZATION</Text>
                <Text style={s.cardBody}>
                  Keeps blocking active when your phone is idle or in your
                  pocket. Without this, limits may stop working in the background.
                </Text>
              </View>
              <Pressable style={s.permBtn} onPress={exemptBattery}>
                <Text style={s.permBtnText}>Exempt</Text>
              </Pressable>
            </View>
          </View>

          <Pressable style={[s.btn, s.btnLetsGo]} onPress={() => onComplete(name.trim())}>
            <Text style={s.btnText}>Let's go 🚀</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 52 },

  logo: {
    fontSize: 26,
    color: C.ink,
    fontWeight: "300",
    letterSpacing: -0.5,
    marginBottom: 28,
  },
  logoEm: { fontStyle: "italic", color: C.amber },

  dots: { flexDirection: "row", gap: 6, marginBottom: 32 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.surf2 },
  dotDone: { backgroundColor: C.amber, opacity: 0.5 },
  dotActive: { width: 24, backgroundColor: C.amber, opacity: 1 },

  head: {
    fontSize: 26,
    fontWeight: "700",
    color: C.ink,
    lineHeight: 33,
    marginBottom: 10,
  },
  sub: { fontSize: 14, color: C.ink2, lineHeight: 21, marginBottom: 24 },

  nameInput: {
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: C.ink,
    marginBottom: 20,
  },

  // app chips grid
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 28 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.surf,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipOn: { backgroundColor: C.amber, borderColor: C.amber },
  chipText: { fontSize: 13.5, color: C.ink2, fontWeight: "500" },
  chipTextOn: { color: C.onAccent, fontWeight: "600" },

  // permission cards
  card: {
    backgroundColor: C.glass,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: C.ink3,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 13,
    color: C.ink2,
    lineHeight: 18,
    marginBottom: 12,
  },
  permRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  permInfo: { flex: 1 },
  permBtn: {
    backgroundColor: C.amber,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  permBtnText: { color: C.onAccent, fontSize: 13, fontWeight: "700" },
  grantedRow: { paddingVertical: 6, alignItems: "flex-start" },
  grantedText: { color: C.green, fontSize: 14, fontWeight: "600" },
  grantedBadge: { color: C.green, fontSize: 22, fontWeight: "700" },

  // primary CTA
  btn: {
    backgroundColor: C.amber,
    paddingVertical: 15,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  btnText: { color: C.onAccent, fontSize: 16, fontWeight: "700" },
  btnOff: { backgroundColor: C.surf2 },
  btnOffText: { color: C.ink3 },
  btnLetsGo: { marginTop: 8 },
  btnGhost: { paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnGhostText: { color: C.ink2, fontSize: 15 },
  warn: { textAlign: "center", color: C.red, fontSize: 12, marginTop: 6 },
});
