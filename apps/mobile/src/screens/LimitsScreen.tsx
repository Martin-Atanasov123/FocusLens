import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  LayoutAnimation,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { C } from "../theme";
import { AppIcon, useAppIcons } from "../components/AppIcon";
import { AppLimit, getAppLimits, removeAppLimit, setAppLimit } from "../blocking/rules";
import { todayUsageSeconds } from "../sync";
import { FREE_LIMIT_MAX } from "../paywall/config";

type Step = "list" | "pick-app" | "pick-time";
type AppRow = { key: string; label: string; secs: number };

const LIMIT_PRESETS_MIN = [15, 30, 60, 120];

function fmtSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${secs}s`;
}

function usagePct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(1, used / limit);
}

export default function LimitsScreen({
  visible,
  onClose,
  isPro = false,
  onRequestUpgrade,
  startAt = "list",
}: {
  visible: boolean;
  onClose: () => void;
  isPro?: boolean;
  /** Called when a free user tries to exceed the limit cap — opens the paywall. */
  onRequestUpgrade?: () => void;
  /** Step to land on when opened — "pick-app" deep-links straight into "add limit". */
  startAt?: Step;
}) {
  const [limits, setLimits] = useState<AppLimit[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [step, setStep] = useState<Step>("list");
  const [editTarget, setEditTarget] = useState<AppLimit | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppRow | null>(null);
  const [limitMinutes, setLimitMinutes] = useState(30);
  const [customInput, setCustomInput] = useState("30");
  const [saving, setSaving] = useState(false);
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);

  const appIcons = useAppIcons([
    ...limits.map((l) => l.packageName),
    ...apps.map((a) => a.key),
  ]);

  const load = useCallback(async () => {
    const [lims, usage] = await Promise.all([
      getAppLimits(),
      todayUsageSeconds().catch(() => [] as AppRow[]),
    ]);
    setLimits(lims);
    const limitedPkgs = new Set(lims.map((l) => l.packageName));
    setApps((usage as AppRow[]).filter((a) => !limitedPkgs.has(a.key)));
  }, []);

  useEffect(() => {
    if (visible) {
      load();
      setStep(startAt);
      setExpandedPkg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, load]);

  const canAddMore = isPro || limits.length < FREE_LIMIT_MAX;

  const openAdd = () => {
    if (!canAddMore) {
      onClose();
      onRequestUpgrade?.();
      return;
    }
    setSelectedApp(null);
    setLimitMinutes(30);
    setCustomInput("30");
    setExpandedPkg(null);
    setStep("pick-app");
  };

  const startEdit = (limit: AppLimit) => {
    setEditTarget(limit);
    const m = Math.round(limit.dailyLimitSecs / 60);
    setLimitMinutes(m);
    setCustomInput(String(m));
    setExpandedPkg(null);
    setStep("pick-time");
  };

  const doRemove = (limit: AppLimit) => {
    Alert.alert(
      "Remove limit?",
      `${limit.label} will no longer be blocked after exceeding a daily limit.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setExpandedPkg(null);
            await removeAppLimit(limit.packageName);
            await load();
          },
        },
      ]
    );
  };

  const saveLimit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const pkg = selectedApp?.key ?? editTarget?.packageName;
      const label = selectedApp?.label ?? editTarget?.label ?? pkg ?? "";
      if (!pkg) return;
      await setAppLimit(pkg, label, limitMinutes * 60);
      await load();
      setStep("list");
      setEditTarget(null);
      setSelectedApp(null);
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (step === "pick-time" && selectedApp) {
      setStep("pick-app");
    } else {
      setStep("list");
      setEditTarget(null);
      setSelectedApp(null);
    }
  };

  const handleClose = () => {
    setStep("list");
    setEditTarget(null);
    setSelectedApp(null);
    onClose();
  };

  const stepTitle = step === "list"
    ? "My Apps"
    : step === "pick-app"
    ? "Choose App"
    : editTarget
    ? "Edit Limit"
    : "Set Limit";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.bar}>
          <Pressable onPress={step === "list" ? handleClose : goBack} hitSlop={12}>
            <Text style={s.back}>{step === "list" ? "‹ Close" : "‹ Back"}</Text>
          </Pressable>
          <Text style={s.title}>{stepTitle}</Text>
          {step === "list" ? (
            <Pressable
              style={[s.addFab, !canAddMore && s.addFabLocked]}
              onPress={openAdd}
              hitSlop={8}
            >
              <Ionicons
                name={canAddMore ? "add" : "lock-closed"}
                size={canAddMore ? 24 : 17}
                color={canAddMore ? C.onAccent : C.ink2}
              />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {/* Step: list */}
        {step === "list" && (
          <FlatList
            data={limits}
            keyExtractor={(l) => l.packageName}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Text style={s.emptyHead}>No limits yet</Text>
                <Text style={s.emptySub}>
                  Set a daily cap on any app — when you hit it, FocusLens blocks
                  it with a one-tap reminder.
                </Text>
              </View>
            }
            ListFooterComponent={
              <View style={s.addWrap}>
                <Pressable
                  style={[s.addBtn, !canAddMore && s.addBtnLocked]}
                  onPress={openAdd}
                >
                  <Text style={[s.addBtnText, !canAddMore && s.addBtnTextLocked]}>
                    {canAddMore ? "+ Add limit" : "🔒  Add limit · Pro"}
                  </Text>
                </Pressable>
                {!isPro && (
                  <Text style={s.freeNote}>
                    Free plan: 1 daily limit. Upgrade for unlimited.
                  </Text>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const expanded = expandedPkg === item.packageName;
              const p = usagePct(item.usedSecs, item.dailyLimitSecs);
              const exceeded = item.usedSecs >= item.dailyLimitSecs;
              const leftSecs = Math.max(0, item.dailyLimitSecs - item.usedSecs);
              return (
                <Pressable
                  style={[s.limitCard, exceeded && s.limitCardBlocked]}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setExpandedPkg(expanded ? null : item.packageName);
                  }}
                >
                  <View style={s.limitTop}>
                    <View style={[s.limitChip, exceeded && s.limitChipBlocked]}>
                      {exceeded && (
                        <Ionicons name="lock-closed" size={11} color={C.red} />
                      )}
                      <Text
                        style={[s.limitChipText, exceeded && s.limitChipTextBlocked]}
                      >
                        {exceeded ? "Blocked" : `${fmtSecs(leftSecs)} left`}
                      </Text>
                    </View>
                    <Text style={s.limitTime}>
                      {fmtSecs(item.usedSecs)} / {fmtSecs(item.dailyLimitSecs)}
                      {item.jokerUsedToday ? " · +5m" : ""}
                    </Text>
                  </View>
                  <View style={s.limitTitleRow}>
                    <AppIcon
                      uri={appIcons[item.packageName]}
                      label={item.label}
                      size={34}
                      locked={exceeded}
                    />
                    <Text style={s.limitLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                  <View style={s.barTrack}>
                    <View
                      style={[
                        s.barFill,
                        { width: `${p * 100}%` },
                        exceeded && s.barFillRed,
                      ]}
                    />
                  </View>

                  {expanded && (
                    <View style={s.actionRow}>
                      <Pressable
                        style={s.actionBtn}
                        onPress={() => startEdit(item)}
                      >
                        <Text style={s.actionEdit}>Edit time</Text>
                      </Pressable>
                      <View style={s.actionDiv} />
                      <Pressable
                        style={s.actionBtn}
                        onPress={() => doRemove(item)}
                      >
                        <Text style={s.actionRemove}>Remove</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        )}

        {/* Step: pick app */}
        {step === "pick-app" && (
          <FlatList
            data={apps}
            keyExtractor={(a) => a.key}
            style={{ flex: 1 }}
            ListHeaderComponent={
              <Text style={s.pickerHint}>
                Pick an app to set a daily screen-time cap.
              </Text>
            }
            ListEmptyComponent={
              <Text style={s.empty}>
                No tracked apps yet. Use your phone for a bit, then come back.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={s.appRow}
                onPress={() => {
                  setSelectedApp(item);
                  setStep("pick-time");
                }}
              >
                <AppIcon uri={appIcons[item.key]} label={item.label} size={36} />
                <View style={s.appRowLeft}>
                  <Text style={s.appRowLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={s.appRowSecs}>{fmtSecs(item.secs)} today</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            )}
          />
        )}

        {/* Step: pick time */}
        {step === "pick-time" && (
          <View style={s.timeWrap}>
            <Text style={s.timeAppName}>
              {selectedApp?.label ?? editTarget?.label}
            </Text>
            <Text style={s.pickerHint}>
              You'll be blocked when you hit this limit for the day.
            </Text>
            <View style={s.presetsRow}>
              {LIMIT_PRESETS_MIN.map((m) => (
                <Pressable
                  key={m}
                  style={[s.preset, limitMinutes === m && s.presetOn]}
                  onPress={() => {
                    setLimitMinutes(m);
                    setCustomInput(String(m));
                    Keyboard.dismiss();
                  }}
                >
                  <Text
                    style={[
                      s.presetText,
                      limitMinutes === m && s.presetTextOn,
                    ]}
                  >
                    {m < 60 ? `${m}m` : `${m / 60}h`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={s.customRow}>
              <TextInput
                style={s.customInput}
                value={customInput}
                onChangeText={(v) => {
                  const digits = v.replace(/[^0-9]/g, "");
                  setCustomInput(digits);
                  const n = parseInt(digits, 10);
                  if (n >= 1 && n <= 1440) setLimitMinutes(n);
                }}
                keyboardType="number-pad"
                maxLength={4}
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              <Text style={s.customUnit}>minutes</Text>
            </View>
            <Pressable
              style={[s.btn, saving && s.btnDisabled]}
              onPress={saveLimit}
              disabled={saving}
            >
              <Text style={s.btnText}>
                {saving
                  ? "Saving…"
                  : `Set ${limitMinutes < 60 ? `${limitMinutes}m` : limitMinutes % 60 === 0 ? `${limitMinutes / 60}h` : `${Math.floor(limitMinutes / 60)}h ${limitMinutes % 60}m`} limit`}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 18,
    paddingTop: 52,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  back: { color: C.amber, fontSize: 16 },
  title: { color: C.ink, fontSize: 18, fontWeight: "700" },

  // mint "+" fab in the header (Opal's Apps screen)
  addFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.amber,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.amber,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  addFabLocked: { backgroundColor: C.surf2, shadowOpacity: 0 },

  // limit cards (Rules-style)
  limitCard: {
    backgroundColor: C.glass,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 12,
  },
  limitCardBlocked: {
    borderColor: "rgba(240,133,115,0.35)",
    backgroundColor: "rgba(240,133,115,0.06)",
  },
  limitTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  limitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.glowFaint,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  limitChipBlocked: { backgroundColor: "rgba(240,133,115,0.15)" },
  limitChipText: { color: C.amber, fontSize: 12, fontWeight: "700" },
  limitChipTextBlocked: { color: C.red },
  limitTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  limitLabel: { color: C.ink, fontSize: 17, fontWeight: "700", flex: 1 },
  limitTime: {
    color: C.ink3,
    fontSize: 12.5,
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    height: 4,
    backgroundColor: C.surf2,
    borderRadius: 99,
    overflow: "hidden",
  },
  barFill: { height: 4, backgroundColor: C.amber, borderRadius: 99 },
  barFillRed: { backgroundColor: C.red },

  // inline action row (expanded)
  actionRow: {
    flexDirection: "row",
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  actionBtn: { flex: 1, paddingVertical: 13, alignItems: "center" },
  actionEdit: { color: C.amber, fontSize: 14, fontWeight: "600" },
  actionRemove: { color: C.red, fontSize: 14, fontWeight: "600" },
  actionDiv: { width: 1, backgroundColor: C.border },

  // empty state
  emptyWrap: {
    paddingTop: 64,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  emptyHead: {
    color: C.ink,
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 10,
  },
  emptySub: {
    color: C.ink2,
    fontSize: 13.5,
    textAlign: "center",
    lineHeight: 21,
  },
  empty: {
    color: C.ink3,
    textAlign: "center",
    paddingVertical: 40,
    fontSize: 14,
  },

  // add button
  addWrap: { paddingVertical: 22 },
  addBtn: {
    backgroundColor: C.amber,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  addBtnLocked: {
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.border,
  },
  addBtnText: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  addBtnTextLocked: { color: C.ink2 },
  freeNote: {
    textAlign: "center",
    color: C.ink3,
    fontSize: 11.5,
    marginTop: 9,
  },

  // app picker
  pickerHint: {
    color: C.ink2,
    fontSize: 13,
    marginBottom: 14,
    marginTop: 4,
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appRowLeft: { flex: 1, marginRight: 8 },
  appRowLabel: { color: C.ink, fontSize: 15, marginBottom: 2 },
  appRowSecs: { color: C.ink3, fontSize: 12 },
  chevron: { color: C.amber, fontSize: 20, fontWeight: "300" },

  // time picker
  timeWrap: { flex: 1 },
  timeAppName: {
    color: C.ink,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
  },
  presetsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
    marginBottom: 36,
  },
  preset: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: C.glass,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  presetOn: { backgroundColor: C.amber, borderColor: C.amber },
  presetText: { color: C.ink2, fontSize: 15, fontWeight: "600" },
  presetTextOn: { color: C.onAccent },

  // custom minutes input
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 24,
  },
  customInput: {
    flex: 1,
    backgroundColor: C.surf,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: "600",
    color: C.ink,
    textAlign: "center",
  },
  customUnit: {
    color: C.ink2,
    fontSize: 15,
    fontWeight: "500",
  },

  // confirm button
  btn: {
    backgroundColor: C.amber,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  btnDisabled: { backgroundColor: C.ink3, opacity: 0.6 },
  btnText: { color: C.onAccent, fontSize: 16, fontWeight: "700" },
});
