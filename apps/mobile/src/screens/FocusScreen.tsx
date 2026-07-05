/**
 * Focus session screen — the daily ritual and the core blocking loop.
 *
 * Pick apps to pause, choose a duration, and start. The native FocusBlocker
 * service then shows a "stay focused" screen over those apps until the timer
 * ends. App list is reused from the usage tracker (apps you actually use).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { C, CTA_GRADIENT } from "../theme";
import BottomNav, { NavTab } from "../components/BottomNav";
import { AppIcon, useAppIcons } from "../components/AppIcon";
import { PressableScale } from "../components/Motion";
import {
  canDrawOverlays,
  isBlocking,
  requestOverlayPermission,
  startFocusSession,
  stopFocusSession,
} from "../blocking/FocusBlocker";
import { isSessionActive, loadRules, saveRules } from "../blocking/rules";
import {
  cancelPendingSession,
  finalizePendingSession,
  markSessionStarted,
} from "../gamification/streaks";
import {
  cancelSessionEndNotification,
  scheduleSessionEndNotification,
} from "../notifications";
import { todayUsageSeconds } from "../sync";

type AppRow = { key: string; label: string };

const STEP_MIN = 5;
const MIN_MINUTES = 5;
const MAX_MINUTES = 240;

function remainingLabel(untilMs: number): string {
  const s = Math.max(0, Math.floor((untilMs - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return minutes % 60 === 0
    ? `${minutes / 60}h`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function FocusScreen({
  visible,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  /** Bottom-nav navigation to Home / My Apps (Timer is this screen). */
  onNavigate?: (tab: NavTab) => void;
}) {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState(30);
  const [overlayOk, setOverlayOk] = useState(true);
  const [activeUntil, setActiveUntil] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  const appIcons = useAppIcons(apps.map((a) => a.key));

  // Load app list + restore any in-progress session when opened.
  useEffect(() => {
    if (!visible) return;
    setOverlayOk(canDrawOverlays());
    (async () => {
      try {
        const usage = await todayUsageSeconds();
        setApps(usage.map((u) => ({ key: u.key, label: u.label })));
      } catch {
        setApps([]);
      }
      const rules = await loadRules();
      if (isBlocking() && isSessionActive(rules)) {
        setActiveUntil(rules.until ?? null);
        setSelected(new Set(rules.packageNames));
      } else {
        setActiveUntil(null);
      }
    })();
  }, [visible]);

  // 1s countdown while a session is active.
  useEffect(() => {
    if (activeUntil == null) return;
    const id = setInterval(() => {
      if (Date.now() >= activeUntil) {
        setActiveUntil(null);
        // Session ran to its deadline → credit the streak right away.
        finalizePendingSession().catch(() => null);
      } else {
        forceTick((n) => n + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [activeUntil]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    if (selected.size === 0) return;
    if (!canDrawOverlays()) {
      requestOverlayPermission();
      setOverlayOk(false);
      return;
    }
    const packageNames = [...selected];
    const until = Date.now() + minutes * 60_000;
    startFocusSession(packageNames, minutes);
    await saveRules({ packageNames, mode: "focusSession", until });
    await markSessionStarted(until, minutes); // streak credit armed
    scheduleSessionEndNotification(until, minutes).catch(() => {});
    setActiveUntil(until);
  }, [selected, minutes]);

  const stop = useCallback(async () => {
    stopFocusSession();
    await saveRules({ packageNames: [], mode: "focusSession" });
    await cancelPendingSession(); // ended early — no streak credit
    cancelSessionEndNotification().catch(() => {});
    setActiveUntil(null);
  }, []);

  const stepDown = () => setMinutes((m) => Math.max(MIN_MINUTES, m - STEP_MIN));
  const stepUp = () => setMinutes((m) => Math.min(MAX_MINUTES, m + STEP_MIN));

  const clock = `${String(minutes).padStart(2, "0")}:00`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.back}>‹ Close</Text>
          </Pressable>
          <View style={{ width: 52 }} />
        </View>
        <Text style={s.bigTitle}>Timer</Text>

        {activeUntil != null ? (
          <View style={s.activeWrap}>
            <Text style={s.activeEye}>FOCUS IN PROGRESS</Text>
            <View style={s.clockCard}>
              <Text style={s.clockDigits} adjustsFontSizeToFit numberOfLines={1}>
                {remainingLabel(activeUntil)}
              </Text>
            </View>
            <Text style={s.activeSub}>
              {selected.size} app{selected.size === 1 ? "" : "s"} paused. Blocked apps
              show a stay-focused screen until the timer ends.
            </Text>
            <Pressable style={s.btnStop} onPress={stop}>
              <Text style={s.btnStopText}>End session</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {!overlayOk && (
              <Pressable style={s.warn} onPress={requestOverlayPermission}>
                <Text style={s.warnText}>
                  ⚠️ Allow “Display over other apps” so FocusLens can show the block
                  screen. Tap to open settings.
                </Text>
              </Pressable>
            )}

            {/* LCD-style duration display */}
            <View style={s.clockCard}>
              <Text style={s.clockDigits}>{clock}</Text>
            </View>

            {/* − / duration / + stepper */}
            <View style={s.stepRow}>
              <PressableScale style={s.stepBtn} scaleTo={0.88} onPress={stepDown}>
                <Text style={s.stepBtnText}>−</Text>
              </PressableScale>
              <View style={s.stepValue}>
                <Text style={s.stepValueText}>{durationLabel(minutes)}</Text>
              </View>
              <PressableScale style={s.stepBtn} scaleTo={0.88} onPress={stepUp}>
                <Text style={s.stepBtnText}>＋</Text>
              </PressableScale>
            </View>

            {/* Start CTA */}
            <PressableScale
              onPress={start}
              disabled={selected.size === 0}
              scaleTo={0.97}
              style={selected.size === 0 ? s.startDisabled : undefined}
            >
              <LinearGradient
                colors={[...CTA_GRADIENT]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.startBtn}
              >
                <Ionicons name="play" size={17} color={C.ink} />
                <Text style={s.startBtnText}>Start</Text>
              </LinearGradient>
            </PressableScale>

            <View style={s.blockedChipWrap}>
              <View style={s.blockedChip}>
                <Ionicons name="shield-half-outline" size={14} color={C.amber} />
                <Text style={s.blockedChipText}>
                  {selected.size > 0
                    ? `${selected.size} app${selected.size === 1 ? "" : "s"} to block`
                    : "Pick apps to block below"}
                </Text>
              </View>
            </View>

            <FlatList
              style={{ flex: 1 }}
              data={apps}
              keyExtractor={(a) => a.key}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 108 }}
              ListEmptyComponent={
                <Text style={s.empty}>
                  No tracked apps yet. Use your phone a bit, then come back.
                </Text>
              }
              renderItem={({ item }) => {
                const on = selected.has(item.key);
                return (
                  <Pressable style={s.appRow} onPress={() => toggle(item.key)}>
                    <View style={[s.check, on && s.checkOn]}>
                      {on && <Text style={s.checkMark}>✓</Text>}
                    </View>
                    <AppIcon uri={appIcons[item.key]} label={item.label} size={32} />
                    <Text style={s.appLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </>
        )}

        {/* Persistent bottom nav, active = Timer */}
        {onNavigate && (
          <BottomNav
            active="timer"
            onNavigate={(tab) => {
              if (tab === "timer") return;
              onClose();
              onNavigate(tab);
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 52 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { color: C.amber, fontSize: 16 },
  bigTitle: { color: C.ink, fontSize: 34, fontWeight: "800", marginTop: 4, marginBottom: 16 },

  // LCD clock display
  clockCard: {
    backgroundColor: "#10241A",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignSelf: "stretch",
    alignItems: "center",
    shadowColor: C.amber,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },
  clockDigits: {
    color: C.amber,
    fontSize: 58,
    fontWeight: "200",
    letterSpacing: 6,
    fontVariant: ["tabular-nums"],
  },

  // stepper
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 20,
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: C.ink, fontSize: 26, fontWeight: "300", lineHeight: 30 },
  stepValue: {
    flex: 1,
    maxWidth: 200,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValueText: { color: C.ink, fontSize: 24, fontWeight: "700" },

  // start CTA
  startBtn: {
    marginTop: 16,
    borderRadius: 999,
    paddingVertical: 17,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.glow,
  },
  startBtnText: { color: C.ink, fontSize: 17, fontWeight: "700" },
  startDisabled: { opacity: 0.45 },

  // blocked-apps chip
  blockedChipWrap: { alignItems: "center", marginTop: 14, marginBottom: 4 },
  blockedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: C.glass,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  blockedChipText: { color: C.ink2, fontSize: 13.5, fontWeight: "600" },

  // app list
  appRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  check: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: C.ink3, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.amber, borderColor: C.amber },
  checkMark: { color: C.onAccent, fontSize: 14, fontWeight: "700" },
  appLabel: { color: C.ink, fontSize: 15, flex: 1 },
  empty: { color: C.ink3, textAlign: "center", paddingVertical: 40, fontSize: 14 },

  btnStop: { backgroundColor: "rgba(240,133,115,0.16)", borderWidth: 1, borderColor: C.red, paddingVertical: 15, paddingHorizontal: 48, borderRadius: 999, alignItems: "center" },
  btnStopText: { color: C.red, fontSize: 16, fontWeight: "700" },
  warn: { backgroundColor: "rgba(245,185,107,0.12)", borderRadius: 16, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.flame },
  warnText: { color: C.flame, fontSize: 13, lineHeight: 18 },
  activeWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, gap: 20 },
  activeEye: { color: C.amber, fontSize: 12, letterSpacing: 1.5, fontWeight: "700" },
  activeSub: { color: C.ink2, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
