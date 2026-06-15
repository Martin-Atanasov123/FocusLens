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

import { C } from "../theme";
import {
  canDrawOverlays,
  isBlocking,
  requestOverlayPermission,
  startFocusSession,
  stopFocusSession,
} from "../blocking/FocusBlocker";
import { isSessionActive, loadRules, saveRules } from "../blocking/rules";
import { todayUsageSeconds } from "../sync";

type AppRow = { key: string; label: string };

const DURATIONS = [25, 60, 120];

function remainingLabel(untilMs: number): string {
  const s = Math.max(0, Math.floor((untilMs - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function FocusScreen({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState(25);
  const [overlayOk, setOverlayOk] = useState(true);
  const [activeUntil, setActiveUntil] = useState<number | null>(null);
  const [, forceTick] = useState(0);

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
    setActiveUntil(until);
  }, [selected, minutes]);

  const stop = useCallback(async () => {
    stopFocusSession();
    await saveRules({ packageNames: [], mode: "focusSession" });
    setActiveUntil(null);
  }, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.back}>‹ Close</Text>
          </Pressable>
          <Text style={s.title}>Focus</Text>
          <View style={{ width: 52 }} />
        </View>

        {activeUntil != null ? (
          <View style={s.activeWrap}>
            <Text style={s.activeEye}>FOCUS IN PROGRESS</Text>
            <Text style={s.activeTime}>{remainingLabel(activeUntil)}</Text>
            <Text style={s.activeSub}>
              {selected.size} app{selected.size === 1 ? "" : "s"} paused. Blocked apps
              show a stay-focused screen until the timer ends.
            </Text>
            <Pressable style={[s.btn, s.btnStop]} onPress={stop}>
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

            <Text style={s.section}>Duration</Text>
            <View style={s.durRow}>
              {DURATIONS.map((d) => (
                <Pressable
                  key={d}
                  style={[s.dur, minutes === d && s.durOn]}
                  onPress={() => setMinutes(d)}
                >
                  <Text style={[s.durText, minutes === d && s.durTextOn]}>
                    {d < 60 ? `${d}m` : `${d / 60}h`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.section}>Apps to pause</Text>
            <FlatList
              style={{ flex: 1 }}
              data={apps}
              keyExtractor={(a) => a.key}
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
                    <Text style={s.appLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
            />

            <Pressable
              style={[s.btn, selected.size === 0 && s.btnDisabled]}
              onPress={start}
              disabled={selected.size === 0}
            >
              <Text style={s.btnText}>
                Start focus · {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 52 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  back: { color: C.amber, fontSize: 16 },
  title: { color: C.ink, fontSize: 18, fontWeight: "600" },
  section: { color: C.ink2, fontSize: 13, fontWeight: "600", marginTop: 18, marginBottom: 8 },
  durRow: { flexDirection: "row", gap: 10 },
  dur: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: C.surf, alignItems: "center", borderWidth: 1, borderColor: C.border },
  durOn: { backgroundColor: C.amber, borderColor: C.amber },
  durText: { color: C.ink2, fontSize: 15, fontWeight: "600" },
  durTextOn: { color: "#fff" },
  appRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.ink3, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "700" },
  appLabel: { color: C.ink, fontSize: 15, flex: 1 },
  empty: { color: C.ink3, textAlign: "center", paddingVertical: 40, fontSize: 14 },
  btn: { backgroundColor: C.amber, paddingVertical: 16, borderRadius: 12, alignItems: "center", marginVertical: 16 },
  btnDisabled: { backgroundColor: C.ink3, opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  btnStop: { backgroundColor: C.red },
  btnStopText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  warn: { backgroundColor: "#FBEFD6", borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: C.amber },
  warnText: { color: "#7A4A06", fontSize: 13, lineHeight: 18 },
  activeWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  activeEye: { color: C.amber, fontSize: 12, letterSpacing: 1.5, fontWeight: "700" },
  activeTime: { color: C.ink, fontSize: 56, fontWeight: "800", marginVertical: 8 },
  activeSub: { color: C.ink2, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 28 },
});
