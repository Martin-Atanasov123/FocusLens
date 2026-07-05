import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  FlatList,
  LayoutAnimation,
  Linking as RNLinking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { CameraView, useCameraPermissions } from "expo-camera";
import { WebView } from "react-native-webview";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { C, CTA_GRADIENT } from "./theme";

import { initSentry } from "./observability";
initSentry(); // no-op until a real DSN is set in observability.ts

import FocusScreen from "./screens/FocusScreen";
import LimitsScreen from "./screens/LimitsScreen";
import OnboardingScreen from "./screens/OnboardingScreen";
import PaywallScreen from "./screens/PaywallScreen";
import ProfileScreen from "./screens/ProfileScreen";
import SchedulesScreen from "./screens/SchedulesScreen";
import WelcomeRitual from "./screens/WelcomeRitual";
import {
  finalizePendingSession,
  getSessionsToday,
  getStreak,
  getTotals,
  takeNewGemUnlocks,
} from "./gamification/streaks";
import { computeScore, saveScoreSnapshot } from "./gamification/score";
import { notifyGemUnlocked, syncStreakReminder } from "./notifications";
import { AppIcon, useAppIcons } from "./components/AppIcon";
import { FadeInView, PressableScale } from "./components/Motion";
import BottomNav from "./components/BottomNav";

// Smooth layout transitions (list growth, expand/collapse) on Android.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { getBlockEventCount, getLimits, AppLimitInfo } from "./blocking/FocusBlocker";
import { useEntitlements } from "./paywall/useEntitlements";
import { FREE_BLOCK_EVENT_LIMIT } from "./paywall/config";
import {
  presentPaywall,
  presentCustomerCenter,
} from "./paywall/purchases";

import {
  PairConfig,
  hasUsagePermission,
  loadConfig,
  openUsageAccessSettings,
  refreshRemoteUrl,
  resolveBaseUrl,
  saveConfig,
  syncNow,
  todayUsageSeconds,
} from "./sync";

type UsageRow = { key: string; label: string; secs: number };

function fmt(secs: number): string {
  // Round to the nearest minute so totals line up with Android Digital
  // Wellbeing (it rounds; truncating showed every app ~1 min short).
  const totalMin = Math.round(secs / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${secs}s`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Hosts allowed as pairing targets: RFC-1918 private ranges + Cloudflare tunnel.
const PRIVATE_IP = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
const TUNNEL_HOST = ".trycloudflare.com";

/** Parse focuslens://pair?url=...&token=... or ?host=&port=&token=
 *  Only accepts private-network hosts and the known tunnel domain to prevent
 *  a malicious QR from redirecting usage data + token to an attacker server. */
function parsePairUrl(url: string): PairConfig | null {
  try {
    const { hostname, queryParams } = Linking.parse(url);
    if (hostname !== "pair" || !queryParams) return null;
    const token = String(queryParams.token ?? "");
    if (token.length < 8) return null;

    const explicit = queryParams.url ? String(queryParams.url) : "";
    if (explicit) {
      const u = new URL(explicit);
      if (!["http:", "https:"].includes(u.protocol)) return null;
      const h = u.hostname;
      if (!PRIVATE_IP.test(h) && !h.endsWith(TUNNEL_HOST)) return null;
      return { baseUrl: u.origin, token };
    }
    const host = queryParams.host ? String(queryParams.host) : "";
    if (!host || !PRIVATE_IP.test(host)) return null;
    const rawPort = String(queryParams.port ?? "48732");
    const port = /^\d{1,5}$/.test(rawPort) ? rawPort : "48732";
    return { baseUrl: `http://${host}:${port}`, token };
  } catch {
    return null;
  }
}

export default function App() {
  const [cfg, setCfg] = useState<PairConfig | null>(null);
  const [permission, setPermission] = useState(false);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [syncState, setSyncState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [manualUrl, setManualUrl] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  const [userName, setUserName] = useState("");
  const [ritualOpen, setRitualOpen] = useState(false);
  const [showDesktop, setShowDesktop] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  // "pick-app" deep-links straight into the add-limit flow (from the Rules picker).
  const [limitsStartAt, setLimitsStartAt] = useState<"list" | "pick-app">("list");
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false); // fallback custom paywall
  const [limits, setLimits] = useState<AppLimitInfo[]>([]);
  const [streakCount, setStreakCount] = useState(0);
  const [sessionsToday, setSessionsToday] = useState(0);

  const { isPro, refresh: refreshEntitlements } = useEntitlements();

  /**
   * Open the RevenueCat paywall. Falls back to the custom PaywallScreen when
   * the RC paywall template hasn't been configured in the dashboard yet.
   */
  const openPaywall = useCallback(async () => {
    const result = await presentPaywall();
    if (result.purchased) {
      refreshEntitlements();
    } else if (result.error) {
      // RC paywall not configured yet → show local fallback
      setPaywallOpen(true);
    }
  }, [refreshEntitlements]);

  // QR scanner
  const [scanning, setScanning] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scanLock = useRef(false);

  // Connection indicator: null = not paired, true = reachable, false = offline
  const [connected, setConnected] = useState<boolean | null>(null);
  // The currently reachable URL (LAN or tunnel), resolved by the heartbeat.
  const [activeBase, setActiveBase] = useState<string | null>(null);

  // ---- Focus Score (derived before hooks so effects can depend on it) -----
  // Real formula lives in gamification/score.ts: 100 baseline − screen-time
  // penalty (2 h free, −8/h after) − limit penalties (−15 blown / −5 near)
  // + completed-session bonus (+5 each, max +15). Loss-framed on purpose.
  const totalSecs = usage.reduce((a, u) => a + u.secs, 0);
  const exceededCount = limits.filter((l) => l.usedSecs >= l.dailyLimitSecs).length;
  const nearCapCount  = limits.filter(
    (l) => l.usedSecs < l.dailyLimitSecs && l.usedSecs / l.dailyLimitSecs >= 0.8
  ).length;
  const { score } = computeScore({
    totalScreenSecs: totalSecs,
    exceededCount,
    nearCapCount,
    sessionsToday,
  });
  const scoreColor = score >= 80 ? C.amber : score >= 50 ? C.flame : C.red;

  // Best-effort daily score history (fuels future weekly report).
  useEffect(() => {
    saveScoreSnapshot(score);
  }, [score]);

  // Score counts up smoothly whenever the target changes (0 → score on open).
  const [displayScore, setDisplayScore] = useState(0);
  useEffect(() => {
    const from = displayScore;
    const startTs = Date.now();
    const DURATION = 900;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - startTs) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(from + (score - from) * eased));
      if (t >= 1) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  // Real launcher icons for today's app list (cached for the session).
  const appIcons = useAppIcons(usage.map((u) => u.key));

  // Orb breathing loop (Opal's gem idles the same way).
  const orbScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbScale, { toValue: 1.05, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(orbScale, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [orbScale]);

  const refresh = useCallback(async () => {
    const perm = await hasUsagePermission();
    setPermission(perm);
    if (perm) {
      try {
        setLimits(getLimits());
        setUsage(await todayUsageSeconds());
      } catch {
        setUsage([]);
      }
    }
    // Credit any focus session that completed while the app was closed,
    // then refresh the streak flame + today's session count.
    await finalizePendingSession().catch(() => null);
    const st = await getStreak().catch(() => null);
    if (st) setStreakCount(st.current);
    const sess = await getSessionsToday().catch(() => 0);
    setSessionsToday(sess);

    // Keep the evening streak reminder aimed at the right day.
    if (st) {
      const today = new Date().toISOString().slice(0, 10);
      syncStreakReminder(st.lastGoodDay === today, st.current).catch(() => {});

      // Celebrate any newly earned gems.
      try {
        const totals = await getTotals();
        const fresh = await takeNewGemUnlocks({
          totals,
          streak: st,
          limitsCount: getLimits().length,
          blockEventCount: getBlockEventCount(),
        });
        fresh.forEach((g) => notifyGemUnlocked(g.name, g.hint).catch(() => {}));
      } catch {
        /* gems are best-effort */
      }
    }
  }, []);

  const completeOnboarding = useCallback(async (name: string) => {
    await AsyncStorage.multiSet([["fl_onboarded", "1"], ["fl_name", name]]);
    setUserName(name);
    setOnboarded(true);
    setRitualOpen(true); // cinematic welcome, then the home screen
    await refresh();
  }, [refresh]);

  // Initial load + deep link wiring
  useEffect(() => {
    (async () => {
      const [saved, onboardedFlag, savedName] = await Promise.all([
        loadConfig(),
        AsyncStorage.getItem("fl_onboarded"),
        AsyncStorage.getItem("fl_name"),
      ]);
      if (saved) setCfg(saved);
      setOnboarded(!!onboardedFlag);
      if (savedName) setUserName(savedName);
      const initial = await RNLinking.getInitialURL();
      if (initial) {
        const pc = parsePairUrl(initial);
        if (pc) {
          await saveConfig(pc);
          setCfg(pc);
          setShowDesktop(true);
        }
      }
      await refresh();
      setLoading(false);
    })();

    const sub = RNLinking.addEventListener("url", async ({ url }) => {
      const pc = parsePairUrl(url);
      if (pc) {
        await saveConfig(pc);
        setCfg(pc);
        setShowDesktop(true);
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Refresh local usage periodically while the app is open
  useEffect(() => {
    if (!permission) return;
    const id = setInterval(() => {
      todayUsageSeconds()
        .then(setUsage)
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [permission]);

  // "Aha moment" paywall: once a free user has been blocked enough times, show
  // the paywall the next time they open the app. Fires at most once (persisted),
  // so it never nags — further upgrades come from feature gates (e.g. 2nd limit).
  useEffect(() => {
    if (isPro || !onboarded || !permission) return;
    let alive = true;
    const maybeShow = async () => {
      if (!alive || (await AsyncStorage.getItem("fl_paywall_seen"))) return;
      if (getBlockEventCount() >= FREE_BLOCK_EVENT_LIMIT) {
        await AsyncStorage.setItem("fl_paywall_seen", "1");
        if (alive) openPaywall();
      }
    };
    maybeShow();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") maybeShow();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [isPro, onboarded, permission, openPaywall]);

  // Connection heartbeat with exponential back-off.
  // On success: 5 s interval. On failure: doubles each time up to 60 s.
  // Prevents near-continuous radio wake when the desktop is offline.
  useEffect(() => {
    if (!cfg) {
      setConnected(null);
      setActiveBase(null);
      return;
    }
    let alive = true;
    let delay = 5_000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      const base = await resolveBaseUrl(cfg);
      if (!alive) return;
      const ok = !!base;
      setConnected(ok);
      setActiveBase(base);
      delay = ok ? 5_000 : Math.min(delay * 2, 60_000);
      timer = setTimeout(check, delay);
    };

    check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [cfg]);

  // On open: learn the current tunnel URL (while on LAN), then sync.
  useEffect(() => {
    if (!cfg || !permission) return;
    (async () => {
      const updated = await refreshRemoteUrl(cfg);
      if (updated.remoteUrl !== cfg.remoteUrl) setCfg(updated);
      syncNow().catch(() => {});
    })();
  }, [cfg, permission]);

  const doSync = useCallback(async () => {
    setSyncState("busy");
    const ok = await syncNow();
    setSyncState(ok ? "ok" : "fail");
    setTimeout(() => setSyncState("idle"), 2500);
  }, []);

  const savePairing = useCallback(async () => {
    const pc: PairConfig = {
      baseUrl: manualUrl.trim().replace(/\/+$/, ""),
      token: manualToken.trim(),
    };
    if (!pc.baseUrl || !pc.token) return;
    await saveConfig(pc);
    setCfg(pc);
  }, [manualUrl, manualToken]);

  const startScan = useCallback(async () => {
    if (!camPerm?.granted) {
      const res = await requestCamPerm();
      if (!res.granted) return;
    }
    scanLock.current = false;
    setScanning(true);
  }, [camPerm, requestCamPerm]);

  const onScanned = useCallback(async ({ data }: { data: string }) => {
    if (scanLock.current) return;
    const pc = parsePairUrl(data);
    if (pc) {
      scanLock.current = true;
      setScanning(false);
      await saveConfig(pc);
      setCfg(pc);
    }
  }, []);

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={C.amber} />
      </View>
    );
  }

  // ---- Onboarding gate: show 3-step flow on first launch -----------------
  if (!onboarded) {
    return <OnboardingScreen onComplete={completeOnboarding} />;
  }

  // ---- Welcome ritual: one cinematic pass right after onboarding ----------
  if (ritualOpen) {
    return <WelcomeRitual name={userName} onDone={() => setRitualOpen(false)} />;
  }

  // ---- Permission gate: nothing works without usage access ----------------
  if (!permission) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <Text style={s.logo}>
          Focus<Text style={s.logoEm}>Lens</Text>
        </Text>
        <Text style={s.tag}>Screen time for your phone</Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>1 · Allow restricted settings</Text>
          <Text style={s.cardBody}>
            Because FocusLens was installed from an APK (not the Play Store),
            Android blocks sensitive permissions until you unlock them once.
            {"\n\n"}Settings → Apps → Manage apps → FocusLens → tap ⋮ (top-right)
            → “Allow restricted settings”.
            {"\n\n"}If you don't see that menu item, you can skip straight to
            step 2 — some phones don't need it.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>2 · Grant usage access</Text>
          <Text style={s.cardBody}>
            This is what lets FocusLens read your per-app screen time. There is
            no popup — it's a one-time manual toggle.
          </Text>
          <Pressable
            style={s.btn}
            onPress={() => {
              openUsageAccessSettings().catch(() => {});
            }}
          >
            <Text style={s.btnText}>Open Usage Access settings →</Text>
          </Pressable>
          <Text style={s.cardBody}>
            {"Xiaomi path if the button doesn't land you there:\nSettings → Apps → Manage apps → FocusLens → Other permissions → View usage data → Enable"}
          </Text>
          <Pressable style={s.btnGhost} onPress={refresh}>
            <Text style={s.btnGhostText}>I enabled it — re-check</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Standalone view: phone screen time is the main content -------------
  const statusColor =
    connected === true ? C.green : connected === false ? C.red : C.ink3;
  const statusText =
    connected === true
      ? "Connected to desktop"
      : connected === false
      ? "Desktop unreachable"
      : "Not connected";

  // Build quick-lookup map: packageName → limit info
  const limitMap: Record<string, AppLimitInfo> = {};
  limits.forEach((l) => { limitMap[l.packageName] = l; });

  const header = (
    <View>
      <View style={s.topBar}>
        <Text style={s.logo}>
          Focus<Text style={s.logoEm}>Lens</Text>
        </Text>
        <View style={s.topRight}>
          <View style={s.streakChip}>
            <Ionicons
              name="flame"
              size={15}
              color={streakCount > 0 ? C.flame : C.ink3}
            />
            <Text style={[s.streakText, streakCount > 0 && { color: C.flame }]}>
              {streakCount}
            </Text>
          </View>
          <Pressable style={s.avatar} onPress={() => setProfileOpen(true)}>
            <Ionicons name="person" size={18} color={C.amber} />
          </Pressable>
        </View>
      </View>

      {userName ? <Text style={s.greeting}>Hey {userName} 👋</Text> : null}

      {/* Hero: glowing lens orb + Focus Score */}
      <FadeInView style={s.hero}>
        <View style={s.orbWrap}>
          <Animated.View style={[s.orbGlow, { transform: [{ scale: orbScale }] }]} />
          <Animated.View style={{ transform: [{ scale: orbScale }] }}>
            <LinearGradient
              colors={["#D8FBE8", "#A9EEC8", "#55B983"]}
              start={{ x: 0.2, y: 0.1 }}
              end={{ x: 0.85, y: 1 }}
              style={s.orb}
            />
          </Animated.View>
        </View>
        <Text style={s.heroEye}>FOCUS SCORE</Text>
        <Text style={[s.heroNum, { color: scoreColor }]}>{displayScore}</Text>
        <View style={s.screenTimeChip}>
          <Ionicons name="time-outline" size={13} color={C.ink3} />
          <Text style={s.heroDate}>
            {fmt(totalSecs)} on screen · {todayStr()}
          </Text>
        </View>
      </FadeInView>

      {/* Quick actions — dashed pills like Opal's Sleep / Focus / Rest */}
      <FadeInView delay={120} style={s.actionRow}>
        <View style={s.actionCol}>
          <PressableScale style={s.pillBtn} scaleTo={0.92} onPress={() => setFocusOpen(true)}>
            <Ionicons name="hourglass-outline" size={20} color={C.amber} />
          </PressableScale>
          <Text style={s.pillLabel}>Focus</Text>
        </View>
        <View style={s.actionCol}>
          <PressableScale style={s.pillBtn} scaleTo={0.92} onPress={() => setLimitsOpen(true)}>
            <Ionicons name="shield-half-outline" size={20} color={C.amber} />
          </PressableScale>
          <Text style={s.pillLabel}>Limits</Text>
        </View>
        <View style={s.actionCol}>
          <PressableScale style={s.pillBtn} scaleTo={0.92} onPress={() => setSchedulesOpen(true)}>
            <Ionicons name="calendar-outline" size={20} color={C.amber} />
          </PressableScale>
          <Text style={s.pillLabel}>Rules</Text>
        </View>
      </FadeInView>

      {/* "My Apps" style card: limits summary */}
      <FadeInView delay={220}>
      <PressableScale style={s.myAppsCard} scaleTo={0.98} onPress={() => setLimitsOpen(true)}>
        <View style={s.myAppsHead}>
          <Text style={s.myAppsTitle}>My Limits</Text>
          <Text style={s.myAppsChev}>›</Text>
        </View>
        <View style={s.myAppsRow}>
          <View
            style={[
              s.shieldBadge,
              exceededCount > 0 && { backgroundColor: "rgba(240,133,115,0.15)" },
            ]}
          >
            <Ionicons
              name={exceededCount > 0 ? "lock-closed" : "shield-checkmark"}
              size={20}
              color={exceededCount > 0 ? C.red : C.amber}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.myAppsMain}>
              {limits.length > 0
                ? exceededCount > 0
                  ? `${exceededCount} app${exceededCount > 1 ? "s" : ""} blocked`
                  : nearCapCount > 0
                  ? `${nearCapCount} app${nearCapCount > 1 ? "s" : ""} near cap`
                  : "All limits on track"
                : "No limits yet"}
            </Text>
            <Text style={s.myAppsSub}>
              {limits.length > 0
                ? `${limits.length} daily limit${limits.length > 1 ? "s" : ""} active`
                : "Tap to set your first daily limit"}
            </Text>
          </View>
        </View>
      </PressableScale>
      </FadeInView>

      <View style={s.sectionRule}>
        <Text style={s.sectionLabel}>TODAY'S APPS</Text>
      </View>
    </View>
  );

  const footer = (
    <View style={s.optWrap}>
      {/* Pro: manage / cancel subscription via RevenueCat Customer Center */}
      {isPro && (
        <Pressable style={s.manageBtn} onPress={presentCustomerCenter}>
          <Text style={s.manageBtnText}>Manage subscription</Text>
        </Pressable>
      )}
      {!showDesktop ? (
        <Pressable style={s.optToggle} onPress={() => setShowDesktop(true)}>
          <View style={[s.statusDot, { backgroundColor: cfg ? statusColor : C.ink3 }]} />
          <Text style={s.optToggleText}>
            {cfg ? statusText : "Connect to a desktop (optional)"}
          </Text>
          <Text style={s.optChevron}>⌄</Text>
        </Pressable>
      ) : (
        <View style={s.optCard}>
          <View style={s.optHead}>
            <Text style={s.optLabel}>OPTIONAL · DESKTOP SYNC</Text>
            <Pressable onPress={() => setShowDesktop(false)}>
              <Text style={s.optHide}>hide</Text>
            </Pressable>
          </View>

          <View style={s.statusRow}>
            <View style={[s.statusDot, { backgroundColor: cfg ? statusColor : C.ink3 }]} />
            <Text style={s.statusText}>{cfg ? statusText : "Not connected"}</Text>
          </View>

          {cfg ? (
            <>
              <Text style={s.cardBody} numberOfLines={1}>
                {activeBase || cfg.baseUrl}
                {activeBase && activeBase === cfg.remoteUrl ? " · via tunnel" : ""}
              </Text>
              {connected === true && (
                <Pressable style={s.btn} onPress={() => setDashboardOpen(true)}>
                  <Text style={s.btnText}>🖥️ Open full dashboard</Text>
                </Pressable>
              )}
              <Pressable style={s.btnAlt} onPress={doSync} disabled={syncState === "busy"}>
                <Text style={s.btnAltText}>
                  {syncState === "busy"
                    ? "Syncing…"
                    : syncState === "ok"
                    ? "✓ Synced to desktop"
                    : syncState === "fail"
                    ? "✗ Could not reach desktop"
                    : "Sync now"}
                </Text>
              </Pressable>
              {(syncState === "fail" || connected === false) && (
                <Text style={s.failHint}>
                  {"Phone can't reach the computer. Check:\n• Both on the same Wi-Fi\n• Desktop FocusLens is running\n• On the PC, run allow-phone-access.bat as admin (opens the firewall)"}
                </Text>
              )}
              <Pressable style={s.btnGhost} onPress={startScan}>
                <Text style={s.btnGhostText}>Re-pair / scan a different QR</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.cardBody}>
                Send this phone's usage to the FocusLens desktop app so you see
                phone + computer time together. Desktop → Settings → Show QR →
                “Pair app”.
              </Text>
              <Pressable style={s.btn} onPress={startScan}>
                <Text style={s.btnText}>📷 Scan QR code</Text>
              </Pressable>
              <Text style={s.orText}>— or enter manually —</Text>
              <TextInput
                style={s.input}
                placeholder="http://192.168.1.100:48732"
                placeholderTextColor={C.ink3}
                autoCapitalize="none"
                value={manualUrl}
                onChangeText={setManualUrl}
              />
              <TextInput
                style={s.input}
                placeholder="Pairing token"
                placeholderTextColor={C.ink3}
                autoCapitalize="none"
                value={manualToken}
                onChangeText={setManualToken}
              />
              <Pressable style={s.btnGhost} onPress={savePairing}>
                <Text style={s.btnGhostText}>Save manual pairing</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <FlatList
        data={usage.slice(0, 30)}
        keyExtractor={(i) => i.key}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 108 }}
        onRefresh={refresh}
        refreshing={false}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const max     = usage[0]?.secs || 1;
          const limit   = limitMap[item.key];
          const hasLimit   = !!limit;
          const exceeded   = hasLimit && item.secs >= limit.dailyLimitSecs;
          const nearCap    = hasLimit && !exceeded && item.secs / limit.dailyLimitSecs >= 0.8;
          const barWidth = (hasLimit
            ? `${Math.min(100, (item.secs / limit.dailyLimitSecs) * 100)}%`
            : `${(item.secs / max) * 100}%`) as `${number}%`;

          return (
            <View style={s.row}>
              <AppIcon
                uri={appIcons[item.key]}
                label={item.label}
                size={36}
                locked={exceeded}
              />
              <View style={s.rowLeft}>
                <View style={s.rowTop}>
                  <Text style={s.rowLabel} numberOfLines={1}>{item.label}</Text>
                  {hasLimit ? (
                    <Text style={[s.rowVal, exceeded && s.rowValRed, nearCap && s.rowValAmber]}>
                      {fmt(item.secs)}{" "}
                      <Text style={s.rowValLimit}>/ {fmt(limit.dailyLimitSecs)}</Text>
                    </Text>
                  ) : (
                    <Text style={s.rowVal}>{fmt(item.secs)}</Text>
                  )}
                </View>
                <View style={s.barTrack}>
                  <View style={[
                    s.barFill,
                    { width: barWidth },
                    exceeded && s.barFillRed,
                    nearCap  && s.barFillAmber,
                  ]} />
                </View>
                {hasLimit && limit.jokerUsedToday && (
                  <Text style={s.jokerNote}>🃏 +5 min joker used today</Text>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={s.note}>No app usage recorded yet today.</Text>
        }
      />

      {/* Full desktop dashboard in a WebView */}
      <Modal
        visible={dashboardOpen}
        animationType="slide"
        onRequestClose={() => setDashboardOpen(false)}
      >
        <View style={s.webRoot}>
          <View style={s.webBar}>
            <Pressable onPress={() => setDashboardOpen(false)} hitSlop={12}>
              <Text style={s.webBack}>‹ Back</Text>
            </Pressable>
            <Text style={s.webTitle}>FocusLens · full dashboard</Text>
            <View style={{ width: 48 }} />
          </View>
          {cfg && (
            <WebView
              source={{
                uri:
                  (activeBase || cfg.baseUrl) +
                  "/?token=" +
                  encodeURIComponent(cfg.token),
              }}
              style={{ flex: 1, backgroundColor: C.bg }}
              originWhitelist={["*"]}
            />
          )}
        </View>
      </Modal>

      {/* Persistent bottom navigation with a sliding indicator. */}
      <BottomNav
        active="home"
        onNavigate={(tab) => {
          if (tab === "myapps") setLimitsOpen(true);
          else if (tab === "timer") setFocusOpen(true);
        }}
      />

      <FocusScreen
        visible={focusOpen}
        onClose={() => {
          setFocusOpen(false);
          refresh(); // pick up streak credit from a just-finished session
        }}
        onNavigate={(tab) => {
          // FocusScreen already closed itself; just open the target surface.
          if (tab === "myapps") setLimitsOpen(true);
        }}
      />
      <LimitsScreen
        visible={limitsOpen}
        onClose={() => {
          setLimitsOpen(false);
          setLimitsStartAt("list");
        }}
        isPro={isPro}
        onRequestUpgrade={openPaywall}
        startAt={limitsStartAt}
        onNavigate={(tab) => {
          // LimitsScreen already closed itself; just open the target surface.
          if (tab === "timer") setFocusOpen(true);
        }}
      />
      <SchedulesScreen
        visible={schedulesOpen}
        onClose={() => setSchedulesOpen(false)}
        isPro={isPro}
        onRequestUpgrade={openPaywall}
        onRequestTimeLimit={() => {
          setSchedulesOpen(false);
          setLimitsStartAt("pick-app");
          setLimitsOpen(true);
        }}
      />
      <ProfileScreen
        visible={profileOpen}
        onClose={() => setProfileOpen(false)}
        userName={userName}
      />
      {/* Custom paywall — fallback when RC paywall template not yet configured */}
      <PaywallScreen
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onPurchased={refreshEntitlements}
      />

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={s.scanRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />
          <View style={s.scanFrame} />
          <Text style={s.scanHint}>Point at the “Pair app” QR on your desktop</Text>
          <Pressable style={s.scanCancel} onPress={() => setScanning(false)}>
            <Text style={s.btnText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 60, paddingHorizontal: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 26, color: C.ink, fontWeight: "300", letterSpacing: -0.5 },
  logoEm: { fontStyle: "italic", color: C.amber },
  tag: { fontSize: 12, color: C.ink3, marginBottom: 24 },

  // top bar
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  greeting: { fontSize: 13, color: C.ink3, marginTop: 6 },
  topRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.glass,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  streakText: { color: C.ink3, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: C.glass,
    borderWidth: 1.5,
    borderColor: C.glow,
    alignItems: "center",
    justifyContent: "center",
  },

  // hero: glowing orb + total
  hero: { alignItems: "center", marginTop: 20 },
  orbWrap: { width: 160, height: 150, alignItems: "center", justifyContent: "center" },
  orbGlow: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: C.glowFaint,
    shadowColor: C.amber,
    shadowOpacity: 0.7,
    shadowRadius: 40,
    elevation: 24,
  },
  orb: {
    width: 112,
    height: 112,
    borderRadius: 56,
    shadowColor: C.amber,
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 16,
  },
  heroEye: { fontSize: 10, letterSpacing: 2, color: C.ink3, marginTop: 16, marginBottom: 6 },
  heroNum: { fontSize: 56, fontWeight: "300", color: C.ink, letterSpacing: -2, lineHeight: 62 },
  heroDate: { fontSize: 13, color: C.ink3, fontVariant: ["tabular-nums"] },
  screenTimeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    backgroundColor: C.glass,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  // quick action pills (Sleep / Focus / Rest style)
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    paddingHorizontal: 8,
  },
  actionCol: { alignItems: "center", flex: 1 },
  pillBtn: {
    width: 88,
    height: 52,
    borderRadius: 999,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  pillLabel: { fontSize: 13, color: C.ink2, marginTop: 8, fontWeight: "500" },

  // "My Limits" summary card
  myAppsCard: {
    backgroundColor: C.glass,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginTop: 28,
  },
  myAppsHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  myAppsTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  myAppsChev: { fontSize: 20, color: C.ink3 },
  myAppsRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  shieldBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.glowFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  myAppsMain: { fontSize: 16, fontWeight: "700", color: C.ink },
  myAppsSub: { fontSize: 13, color: C.ink3, marginTop: 2 },

  sectionRule: { marginTop: 28, marginBottom: 8, paddingTop: 14 },
  sectionLabel: { fontSize: 10, letterSpacing: 2, color: C.ink3 },

  // bottom pill nav
  nav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: "center",
  },
  navPill: {
    flexDirection: "row",
    backgroundColor: C.navBg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    padding: 6,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  navItem: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 999,
  },
  navItemActive: { backgroundColor: C.glassHi },
  navLabel: { fontSize: 11, color: C.ink3, fontWeight: "500", marginTop: 2 },
  navLabelActive: { color: C.ink },

  // app rows
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowLeft: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 },
  rowLabel: { fontSize: 14, color: C.ink, flex: 1, marginRight: 8 },
  barTrack: { height: 3, backgroundColor: C.surf2, borderRadius: 99, overflow: "hidden" },
  barFill: { height: 3, backgroundColor: C.amber, borderRadius: 99 },
  barFillAmber: { backgroundColor: C.flame },
  barFillRed: { backgroundColor: C.red },
  rowVal: { fontSize: 12.5, color: C.ink2, fontVariant: ["tabular-nums"] },
  rowValAmber: { color: C.amber },
  rowValRed: { color: C.red },
  rowValLimit: { color: C.ink3, fontSize: 11.5 },
  jokerNote: { fontSize: 11, color: C.ink3, marginTop: 5 },
  note: { fontSize: 12, color: C.ink3, textAlign: "center", paddingVertical: 24 },

  // cards (permission + optional desktop)
  card: {
    backgroundColor: C.glass,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: "600", color: C.ink, marginBottom: 6 },
  cardBody: { fontSize: 12.5, color: C.ink2, lineHeight: 18, marginBottom: 10 },
  btn: { backgroundColor: C.amber, borderRadius: 999, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  btnText: { color: C.onAccent, fontSize: 13.5, fontWeight: "700" },
  btnAlt: { backgroundColor: C.surf2, borderRadius: 999, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  btnAltText: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  btnGhost: { paddingVertical: 10, alignItems: "center" },
  btnGhostText: { color: C.ink2, fontSize: 12.5 },
  failHint: { fontSize: 11.5, color: C.red, lineHeight: 17, marginTop: 10 },
  orText: { fontSize: 11, color: C.ink3, textAlign: "center", marginVertical: 10 },
  input: {
    backgroundColor: C.surf,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: C.ink,
    marginBottom: 8,
  },

  // manage subscription (Pro only)
  manageBtn: { paddingVertical: 10, alignItems: "center", marginBottom: 8 },
  manageBtnText: { fontSize: 12.5, color: C.ink3, textDecorationLine: "underline" },

  // optional desktop section
  optWrap: { marginTop: 24, marginBottom: 40 },
  optToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.glass,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  optToggleText: { flex: 1, fontSize: 13, color: C.ink2, marginLeft: 10 },
  optChevron: { fontSize: 16, color: C.ink3 },
  optCard: {
    backgroundColor: C.glass,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  optHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  optLabel: { fontSize: 10, letterSpacing: 1.5, color: C.ink3 },
  optHide: { fontSize: 12, color: C.ink3 },
  statusRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { fontSize: 12.5, color: C.ink2, fontWeight: "500", marginLeft: 8 },

  // full dashboard webview
  webRoot: { flex: 1, backgroundColor: C.bg, paddingTop: 40 },
  webBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
  },
  webBack: { fontSize: 15, color: C.amber, fontWeight: "600", width: 48 },
  webTitle: { fontSize: 13, color: C.ink2, fontWeight: "500" },

  // scanner
  scanRoot: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  scanFrame: { width: 240, height: 240, borderColor: "#fff", borderWidth: 3, borderRadius: 20, backgroundColor: "transparent" },
  scanHint: { position: "absolute", top: 90, color: "#fff", fontSize: 14, textAlign: "center", paddingHorizontal: 30 },
  scanCancel: { position: "absolute", bottom: 60, backgroundColor: C.amber, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 40 },
});
