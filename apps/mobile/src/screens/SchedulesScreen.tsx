/**
 * Rules — Opal's unified "Rules" system: recurring block rules of two kinds,
 * shown in one list, each with a view screen (summary + Edit/Pause) and an
 * edit screen (Hold to Commit to save). A third type, Time Limit, reuses the
 * existing daily-limits flow in LimitsScreen — the "New rule" picker below
 * just deep-links there instead of duplicating that UI.
 *
 *   Schedule   — block chosen apps during a recurring day/time window.
 *   Open Limit — cap how many times chosen apps can be opened per day, and
 *                how long each open is allowed to last.
 *
 * Both are enforced natively (ScheduleStore.kt + FocusBlockerService) with no
 * JS involvement once saved. Free tier: FREE_RULE_MAX rule(s) total.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { C, CTA_GRADIENT } from "../theme";
import { AppIcon, useAppIcons } from "../components/AppIcon";
import { HoldToCommitButton, PressableScale } from "../components/Motion";
import {
  getOpenCountToday,
  getScheduleRules,
  removeScheduleRule,
  ScheduleRule,
  setScheduleEnabled,
  setScheduleRule,
} from "../blocking/FocusBlocker";
import { loadAllApps } from "../appList";
import { FREE_RULE_MAX } from "../paywall/config";

type AppRow = { key: string; label: string };
type Step = "list" | "view" | "edit";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]; // ISO 1..7
const WEEKDAYS = [1, 2, 3, 4, 5];

function fmtMinute(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

function daysSummary(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  if (WEEKDAYS.every((d) => set.has(d)) && set.size === 5) return "Weekdays";
  if (set.has(6) && set.has(7) && set.size === 2) return "Weekends";
  return [...days].sort().map((d) => DAY_LABELS[d - 1]).join(" ");
}

/** Mirrors ScheduleStore.isActiveNow (Kotlin) so the list can label instantly. */
function isScheduleActiveNow(rule: ScheduleRule, now = new Date()): boolean {
  const isoDay = ((now.getDay() + 6) % 7) + 1;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const start = rule.startMinute ?? 0;
  const end = rule.endMinute ?? 0;
  if (start <= end) {
    return isoDay in daySetOf(rule) && minuteOfDay >= start && minuteOfDay < end;
  }
  const prevIso = isoDay === 1 ? 7 : isoDay - 1;
  return (
    (daySetOf(rule).has(isoDay) && minuteOfDay >= start) ||
    (daySetOf(rule).has(prevIso) && minuteOfDay < end)
  );
}
function daySetOf(rule: ScheduleRule): Set<number> {
  return new Set(rule.daysOfWeek);
}

/** "6h left" / "Starts in 16h" / "Starts in 2d" — the badge Opal shows on cards. */
function scheduleStatusLabel(rule: ScheduleRule): string {
  const now = new Date();
  if (isScheduleActiveNow(rule, now)) {
    const end = rule.endMinute ?? 0;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const leftMin = end > nowMin ? end - nowMin : 24 * 60 - nowMin + end;
    const h = Math.floor(leftMin / 60);
    const m = leftMin % 60;
    return h > 0 ? `${h}h left` : `${m}m left`;
  }
  // Find the next active day/start combo within the next 7 days.
  const isoToday = ((now.getDay() + 6) % 7) + 1;
  for (let add = 0; add <= 7; add++) {
    const isoDay = ((isoToday - 1 + add) % 7) + 1;
    if (!daySetOf(rule).has(isoDay)) continue;
    const target = new Date(now);
    target.setDate(now.getDate() + add);
    target.setHours(Math.floor((rule.startMinute ?? 0) / 60), (rule.startMinute ?? 0) % 60, 0, 0);
    if (target.getTime() <= now.getTime()) continue;
    const diffMs = target.getTime() - now.getTime();
    const diffH = Math.round(diffMs / 3_600_000);
    if (diffH < 24) return `Starts in ${Math.max(1, diffH)}h`;
    return `Starts in ${Math.round(diffH / 24)}d`;
  }
  return "Scheduled";
}

/** Blank Schedule draft: weekdays 9:00–18:00 — the classic "work time" rule. */
function newScheduleDraft(): ScheduleRule {
  return {
    id: `rule_${Date.now()}`,
    name: "",
    type: "schedule",
    packageNames: [],
    daysOfWeek: [...WEEKDAYS],
    startMinute: 9 * 60,
    endMinute: 18 * 60,
    strict: false,
    enabled: true,
  };
}

/** Blank Open Limit draft: 10 opens/day, 5 min each — Opal's example values. */
function newOpenLimitDraft(): ScheduleRule {
  return {
    id: `rule_${Date.now()}`,
    name: "",
    type: "openLimit",
    packageNames: [],
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    maxOpens: 10,
    perOpenSeconds: 5 * 60,
    strict: false,
    enabled: true,
  };
}

export default function SchedulesScreen({
  visible,
  onClose,
  isPro = false,
  onRequestUpgrade,
  onRequestTimeLimit,
}: {
  visible: boolean;
  onClose: () => void;
  isPro?: boolean;
  onRequestUpgrade?: () => void;
  /** "Time limit" in the New Rule picker deep-links here instead of duplicating that UI. */
  onRequestTimeLimit?: () => void;
}) {
  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [step, setStep] = useState<Step>("list");
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [viewing, setViewing] = useState<ScheduleRule | null>(null);
  const [draft, setDraft] = useState<ScheduleRule>(newScheduleDraft());
  const [isNew, setIsNew] = useState(true);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [appSearch, setAppSearch] = useState("");

  const appIcons = useAppIcons([
    ...apps.map((a) => a.key), // all apps — cache makes this a one-time cost
    ...rules.flatMap((r) => r.packageNames),
  ]);

  const load = useCallback(async () => {
    const rs = getScheduleRules();
    setRules(rs);
    try {
      const all = await loadAllApps();
      setApps(all.map((u) => ({ key: u.key, label: u.label })));
    } catch {
      setApps([]);
    }
    // Live "N of M opens today" for Open Limit cards (sum across its apps).
    const openRules = rs.filter((r) => r.type === "openLimit");
    const counts: Record<string, number> = {};
    for (const r of openRules) {
      let sum = 0;
      for (const pkg of r.packageNames) sum += getOpenCountToday(r.id, pkg);
      counts[r.id] = sum;
    }
    setOpenCounts(counts);
  }, []);

  useEffect(() => {
    if (visible) {
      load();
      setStep("list");
    }
  }, [visible, load]);

  const canAddMore = isPro || rules.length < FREE_RULE_MAX;

  const openTypePicker = () => {
    if (!canAddMore) {
      onClose();
      onRequestUpgrade?.();
      return;
    }
    setTypePickerOpen(true);
  };

  const pickType = (type: "schedule" | "openLimit" | "timeLimit") => {
    setTypePickerOpen(false);
    if (type === "timeLimit") {
      onClose();
      onRequestTimeLimit?.();
      return;
    }
    setDraft(type === "schedule" ? newScheduleDraft() : newOpenLimitDraft());
    setIsNew(true);
    setAppSearch("");
    setStep("edit");
  };

  const openView = (rule: ScheduleRule) => {
    setViewing(rule);
    setStep("view");
  };

  const openEditFromView = () => {
    if (!viewing) return;
    setDraft({ ...viewing });
    setIsNew(false);
    setAppSearch("");
    setStep("edit");
  };

  const toggleDay = (day: number) =>
    setDraft((d) => {
      const set = new Set(d.daysOfWeek);
      set.has(day) ? set.delete(day) : set.add(day);
      return { ...d, daysOfWeek: [...set] };
    });

  const toggleApp = (key: string) =>
    setDraft((d) => {
      const set = new Set(d.packageNames);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...d, packageNames: [...set] };
    });

  const stepTime = (field: "startMinute" | "endMinute", delta: number) =>
    setDraft((d) => ({ ...d, [field]: ((d[field] ?? 0) + delta + 1440) % 1440 }));

  const stepOpens = (delta: number) =>
    setDraft((d) => ({ ...d, maxOpens: Math.max(1, Math.min(200, (d.maxOpens ?? 1) + delta)) }));

  const stepPerOpenMin = (delta: number) =>
    setDraft((d) => ({
      ...d,
      perOpenSeconds: Math.max(60, Math.min(180 * 60, (d.perOpenSeconds ?? 60) + delta * 60)),
    }));

  const toggleStrict = () => {
    if (!isPro) {
      onClose();
      onRequestUpgrade?.();
      return;
    }
    setDraft((d) => ({ ...d, strict: !d.strict }));
  };

  const canSave = draft.packageNames.length > 0 && draft.daysOfWeek.length > 0;

  const save = () => {
    if (!canSave) return;
    setScheduleRule({ ...draft, name: draft.name.trim() || "Blocked" });
    load();
    setStep("list");
  };

  const doPause = () => {
    if (!viewing) return;
    setScheduleEnabled(viewing.id, !viewing.enabled);
    load();
    setStep("list");
  };

  const doRemove = (rule: ScheduleRule) => {
    Alert.alert("Delete rule?", `"${rule.name}" will stop blocking its apps.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          removeScheduleRule(rule.id);
          load();
          setStep("list");
        },
      },
    ]);
  };

  const barTitle =
    step === "list" ? "Rules" : step === "view" ? viewing?.name ?? "Rule" : draft.name || "New Rule";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.bar}>
          <Pressable
            onPress={
              step === "list" ? onClose : step === "edit" && !isNew ? () => setStep("view") : () => setStep("list")
            }
            hitSlop={12}
          >
            <Text style={s.back}>{step === "list" ? "‹ Close" : "‹ Back"}</Text>
          </Pressable>
          <Text style={s.title} numberOfLines={1}>{barTitle}</Text>
          {step === "list" ? (
            <Pressable style={[s.addFab, !canAddMore && s.addFabLocked]} onPress={openTypePicker} hitSlop={8}>
              <Ionicons name={canAddMore ? "add" : "lock-closed"} size={canAddMore ? 24 : 17}
                color={canAddMore ? C.onAccent : C.ink2} />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {/* ---- List ---- */}
        {step === "list" && (
          <FlatList
            data={rules}
            keyExtractor={(r) => r.id}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Ionicons name="calendar-outline" size={40} color={C.ink3} />
                <Text style={s.emptyHead}>No rules yet</Text>
                <Text style={s.emptySub}>
                  Block apps on a schedule, or cap how many times you can open them —
                  set it once, it runs forever.
                </Text>
              </View>
            }
            ListFooterComponent={
              !isPro && rules.length > 0 ? (
                <Text style={s.freeNote}>Free plan: {FREE_RULE_MAX} rule. Upgrade for unlimited.</Text>
              ) : null
            }
            renderItem={({ item }) => {
              const badge =
                item.type === "openLimit"
                  ? `${openCounts[item.id] ?? 0}/${item.maxOpens} opens`
                  : scheduleStatusLabel(item);
              return (
                <PressableScale scaleTo={0.98} onPress={() => openView(item)}>
                  <View style={[s.ruleCard, !item.enabled && s.ruleCardPaused]}>
                    <View style={s.ruleIconPill}>
                      <Ionicons
                        name={item.type === "openLimit" ? "lock-closed-outline" : "calendar-outline"}
                        size={16}
                        color={item.enabled ? C.amber : C.ink3}
                      />
                      <Ionicons name="arrow-forward" size={12} color={C.ink3} />
                      <Ionicons name="shield" size={16} color={item.enabled ? C.amber : C.ink3} />
                    </View>
                    <View style={s.ruleBadge}>
                      <Text style={s.ruleBadgeText}>{item.enabled ? badge : "Paused"}</Text>
                    </View>
                    <Text style={s.ruleName}>{item.name}</Text>
                    <View style={s.ruleBottom}>
                      <Text style={s.ruleMeta}>
                        {item.packageNames.length} app{item.packageNames.length === 1 ? "" : "s"} blocked
                      </Text>
                      <View style={s.ruleIcons}>
                        {item.packageNames.slice(0, 4).map((pkg) => (
                          <AppIcon key={pkg} uri={appIcons[pkg]} label={pkg} size={20} />
                        ))}
                      </View>
                    </View>
                  </View>
                </PressableScale>
              );
            }}
          />
        )}

        {/* ---- View (summary) ---- */}
        {step === "view" && viewing && (
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.viewIconPill}>
              <Ionicons name={viewing.type === "openLimit" ? "lock-closed-outline" : "calendar-outline"}
                size={18} color={C.amber} />
              <Ionicons name="arrow-forward" size={13} color={C.ink3} />
              <Ionicons name="shield" size={18} color={C.amber} />
            </View>
            <Text style={s.viewName}>{viewing.name}</Text>
            <Text style={s.viewSub}>
              Block {viewing.packageNames.map((p) => appLabelFor(apps, p)).join(", ") || "apps"}
            </Text>
            <View style={s.viewBadge}>
              <Text style={s.ruleBadgeText}>
                {viewing.type === "openLimit"
                  ? `${openCounts[viewing.id] ?? 0}/${viewing.maxOpens} opens today`
                  : scheduleStatusLabel(viewing)}
              </Text>
            </View>

            <View style={s.detailCard}>
              {viewing.type === "schedule" ? (
                <>
                  <DetailRow label="During this time"
                    value={`${fmtMinute(viewing.startMinute ?? 0)} – ${fmtMinute(viewing.endMinute ?? 0)}`} />
                  <DetailRow label="On these days" value={daysSummary(viewing.daysOfWeek)} />
                  <DetailRow label="Block apps"
                    value={viewing.packageNames.map((p) => appLabelFor(apps, p)).join(", ")} />
                  <DetailRow label="Breaks allowed" value={viewing.strict ? "No" : "Yes"} last />
                </>
              ) : (
                <>
                  <DetailRow label="Opens allowed" value={`${viewing.maxOpens}/day`} />
                  <DetailRow label="Duration per open" value={`${Math.round((viewing.perOpenSeconds ?? 0) / 60)}m`} />
                  <DetailRow label="On these days" value={daysSummary(viewing.daysOfWeek)} />
                  <DetailRow label="Apps" value={viewing.packageNames.map((p) => appLabelFor(apps, p)).join(", ")} />
                  <DetailRow label="Resets allowed" value={viewing.strict ? "No" : "Yes"} last />
                </>
              )}
            </View>

            <Pressable style={s.editRuleBtn} onPress={openEditFromView}>
              <Ionicons name="pencil" size={15} color={C.onAccent} />
              <Text style={s.editRuleBtnText}>Edit rule</Text>
            </Pressable>
            <Pressable style={s.pauseBtn} onPress={doPause}>
              <Ionicons name={viewing.enabled ? "pause" : "play"} size={14} color={C.red} />
              <Text style={s.pauseBtnText}>{viewing.enabled ? "Pause rule" : "Resume rule"}</Text>
            </Pressable>
            <View style={{ height: 24 }} />
          </ScrollView>
        )}

        {/* ---- Edit ---- */}
        {step === "edit" && (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <TextInput
              style={s.nameInput}
              placeholder={draft.type === "openLimit" ? "Open Limit" : "Work Time"}
              placeholderTextColor={C.ink3}
              value={draft.name}
              onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
              maxLength={30}
            />

            {draft.type === "schedule" ? (
              <View style={s.card}>
                <View style={s.cardHead}>
                  <Ionicons name="calendar-outline" size={16} color={C.amber} />
                  <Text style={s.cardHeadText}>During this time</Text>
                </View>
                <View style={s.timeRow}>
                  {(["startMinute", "endMinute"] as const).map((field) => (
                    <View key={field} style={s.timeBox}>
                      <Text style={s.timeBoxLabel}>{field === "startMinute" ? "From" : "To"}</Text>
                      <View style={s.timeStepper}>
                        <Pressable style={s.timeBtn} onPress={() => stepTime(field, -30)}>
                          <Text style={s.timeBtnText}>−</Text>
                        </Pressable>
                        <Text style={s.timeValue}>{fmtMinute(draft[field] ?? 0)}</Text>
                        <Pressable style={s.timeBtn} onPress={() => stepTime(field, 30)}>
                          <Text style={s.timeBtnText}>＋</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
                {(draft.startMinute ?? 0) > (draft.endMinute ?? 0) && (
                  <Text style={s.overnightNote}>
                    🌙 Overnight window — blocks until {fmtMinute(draft.endMinute ?? 0)} the next morning.
                  </Text>
                )}
                <DaySelector days={draft.daysOfWeek} onToggle={toggleDay} />
              </View>
            ) : (
              <View style={s.card}>
                <View style={s.cardHead}>
                  <Ionicons name="lock-closed-outline" size={16} color={C.amber} />
                  <Text style={s.cardHeadText}>Open limit</Text>
                </View>
                <View style={s.timeRow}>
                  <View style={s.timeBox}>
                    <Text style={s.timeBoxLabel}>App opens · per day</Text>
                    <View style={s.timeStepper}>
                      <Pressable style={s.timeBtn} onPress={() => stepOpens(-1)}>
                        <Text style={s.timeBtnText}>−</Text>
                      </Pressable>
                      <Text style={s.timeValue}>{draft.maxOpens}</Text>
                      <Pressable style={s.timeBtn} onPress={() => stepOpens(1)}>
                        <Text style={s.timeBtnText}>＋</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={s.timeBox}>
                    <Text style={s.timeBoxLabel}>For this long · daily</Text>
                    <View style={s.timeStepper}>
                      <Pressable style={s.timeBtn} onPress={() => stepPerOpenMin(-1)}>
                        <Text style={s.timeBtnText}>−</Text>
                      </Pressable>
                      <Text style={s.timeValue}>{Math.round((draft.perOpenSeconds ?? 0) / 60)}m</Text>
                      <Pressable style={s.timeBtn} onPress={() => stepPerOpenMin(1)}>
                        <Text style={s.timeBtnText}>＋</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
                <DaySelector days={draft.daysOfWeek} onToggle={toggleDay} />
              </View>
            )}

            <View style={s.card}>
              <View style={s.cardHead}>
                <Ionicons name="shield-checkmark" size={16} color={C.amber} />
                <Text style={s.cardHeadText}>
                  {draft.type === "openLimit" ? "For these apps" : "Apps are blocked"}
                </Text>
              </View>
              <View style={s.searchBar}>
                <Ionicons name="search" size={16} color={C.ink3} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search apps"
                  placeholderTextColor={C.ink3}
                  value={appSearch}
                  onChangeText={setAppSearch}
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {appSearch.length > 0 && (
                  <Pressable onPress={() => setAppSearch("")} hitSlop={10}>
                    <Ionicons name="close-circle" size={16} color={C.ink3} />
                  </Pressable>
                )}
              </View>
              {apps.length === 0 && draft.packageNames.length === 0 && (
                <Text style={s.emptySub}>Loading your apps…</Text>
              )}
              {apps
                .filter((a) =>
                  appSearch.trim()
                    ? a.label.toLowerCase().includes(appSearch.trim().toLowerCase())
                    : true
                )
                .map((a) => {
                  const on = draft.packageNames.includes(a.key);
                  return (
                    <Pressable key={a.key} style={s.appRow} onPress={() => toggleApp(a.key)}>
                      <View style={[s.check, on && s.checkOn]}>
                        {on && <Ionicons name="checkmark" size={15} color={C.onAccent} />}
                      </View>
                      <AppIcon uri={appIcons[a.key]} label={a.label} size={32} />
                      <Text style={s.appLabel} numberOfLines={1}>{a.label}</Text>
                    </Pressable>
                  );
                })}

              <Pressable style={s.strictRow} onPress={toggleStrict}>
                <View style={{ flex: 1 }}>
                  <View style={s.strictLabelRow}>
                    <Text style={s.strictLabel}>Hard mode</Text>
                    {!isPro && (
                      <View style={s.proChip}>
                        <Ionicons name="flash" size={10} color={C.amber} />
                        <Text style={s.proChipText}>PRO</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.strictHint}>
                    {draft.type === "openLimit" ? "No resets allowed" : "No unblocks allowed"}
                  </Text>
                </View>
                <View style={[s.toggleTrack, draft.strict && s.toggleTrackOn]}>
                  <View style={[s.toggleThumb, draft.strict && s.toggleThumbOn]} />
                </View>
              </Pressable>
            </View>

            <HoldToCommitButton
              label={canSave ? "Hold to Commit" : draft.packageNames.length === 0 ? "Pick at least one app" : "Pick at least one day"}
              onCommit={save}
              disabled={!canSave}
              style={s.commitBtn}
              textStyle={s.commitBtnText}
            />

            {!isNew && (
              <Pressable style={s.deleteBtn} onPress={() => doRemove(draft)}>
                <Text style={s.deleteBtnText}>Delete rule</Text>
              </Pressable>
            )}
            <View style={{ height: 32 }} />
          </ScrollView>
        )}

        {/* ---- New Rule type picker ---- */}
        <Modal visible={typePickerOpen} animationType="slide" transparent onRequestClose={() => setTypePickerOpen(false)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setTypePickerOpen(false)}>
            <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={s.sheetGrip} />
              <View style={s.sheetHead}>
                <Pressable onPress={() => setTypePickerOpen(false)} hitSlop={10}>
                  <Ionicons name="close" size={20} color={C.ink2} />
                </Pressable>
                <Text style={s.sheetTitle}>New rule</Text>
                <View style={{ width: 20 }} />
              </View>
              <View style={s.sheetRow}>
                <TypeCard icon="calendar-outline" title="Schedule" hint="e.g. 9-5, Daily" onPress={() => pickType("schedule")} />
                <TypeCard icon="hourglass-outline" title="Time limit" hint="e.g. 45m/day" onPress={() => pickType("timeLimit")} />
                <TypeCard icon="lock-closed-outline" title="Open limit" hint="e.g. 5 opens" onPress={() => pickType("openLimit")} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

function appLabelFor(apps: AppRow[], pkg: string): string {
  return apps.find((a) => a.key === pkg)?.label ?? pkg;
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function DaySelector({ days, onToggle }: { days: number[]; onToggle: (d: number) => void }) {
  return (
    <>
      <View style={s.dayHeadRow}>
        <Text style={s.dayHeadLabel}>On these days:</Text>
        <Text style={s.dayHeadValue}>{daysSummary(days)}</Text>
      </View>
      <View style={s.dayRow}>
        {DAY_LABELS.map((label, i) => {
          const day = i + 1;
          const on = days.includes(day);
          return (
            <Pressable key={day} style={[s.dayChip, on && s.dayChipOn]} onPress={() => onToggle(day)}>
              <Text style={[s.dayChipText, on && s.dayChipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function TypeCard({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={s.typeCard} scaleTo={0.95} onPress={onPress}>
      <Ionicons name={icon} size={22} color={C.amber} />
      <Text style={s.typeCardTitle}>{title}</Text>
      <Text style={s.typeCardHint}>{hint}</Text>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 52 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 },
  back: { color: C.amber, fontSize: 16 },
  title: { color: C.ink, fontSize: 18, fontWeight: "700", flex: 1, textAlign: "center" },
  addFab: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.amber,
    alignItems: "center", justifyContent: "center",
    shadowColor: C.amber, shadowOpacity: 0.6, shadowRadius: 16, elevation: 8,
  },
  addFabLocked: { backgroundColor: C.surf2, shadowOpacity: 0 },

  // rule cards
  ruleCard: {
    backgroundColor: C.glass, borderRadius: 24, borderWidth: 1, borderColor: C.border,
    padding: 18, marginBottom: 12,
  },
  ruleCardPaused: { opacity: 0.55 },
  ruleIconPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", backgroundColor: C.glowFaint, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12,
  },
  ruleBadge: {
    alignSelf: "flex-start", backgroundColor: C.surf, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10,
  },
  ruleBadgeText: { color: C.ink2, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  ruleName: { color: C.ink, fontSize: 19, fontWeight: "700" },
  ruleBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  ruleMeta: { color: C.ink3, fontSize: 12.5 },
  ruleIcons: { flexDirection: "row", alignItems: "center", gap: 4 },

  // empty state
  emptyWrap: { paddingTop: 64, paddingHorizontal: 16, alignItems: "center", gap: 10 },
  emptyHead: { color: C.ink, fontSize: 17, fontWeight: "600" },
  emptySub: { color: C.ink2, fontSize: 13.5, textAlign: "center", lineHeight: 21 },
  freeNote: { textAlign: "center", color: C.ink3, fontSize: 11.5, marginTop: 9 },

  // view (summary) screen
  viewIconPill: {
    flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center",
    borderWidth: 1, borderColor: C.border, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 12,
  },
  viewName: { color: C.ink, fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: 20 },
  viewSub: { color: C.ink2, fontSize: 14, textAlign: "center", marginTop: 6 },
  viewBadge: {
    alignSelf: "center", backgroundColor: C.glass, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 14,
  },
  detailCard: {
    backgroundColor: C.glass, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    marginTop: 24, paddingHorizontal: 18,
  },
  detailRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12,
  },
  detailLabel: { color: C.ink, fontSize: 14.5, fontWeight: "500" },
  detailValue: { color: C.ink2, fontSize: 14, flexShrink: 1, textAlign: "right" },
  editRuleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.amber, borderRadius: 999, paddingVertical: 16, marginTop: 28,
  },
  editRuleBtnText: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  pauseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 16 },
  pauseBtnText: { color: C.red, fontSize: 14.5, fontWeight: "600" },

  // edit screen
  nameInput: {
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.border, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: C.ink, marginBottom: 16,
  },
  card: {
    backgroundColor: C.glass, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    padding: 18, marginBottom: 14,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  cardHeadText: { color: C.ink, fontSize: 15, fontWeight: "700" },

  timeRow: { flexDirection: "row", gap: 12, marginBottom: 6 },
  timeBox: { flex: 1 },
  timeBoxLabel: { color: C.ink3, fontSize: 11.5, marginBottom: 6 },
  timeStepper: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.surf,
    borderWidth: 1, borderColor: C.border, borderRadius: 999, overflow: "hidden",
  },
  timeBtn: { paddingVertical: 12, paddingHorizontal: 14 },
  timeBtnText: { color: C.ink, fontSize: 18, fontWeight: "400" },
  timeValue: { flex: 1, textAlign: "center", color: C.ink, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  overnightNote: { color: C.ink3, fontSize: 12, marginTop: 8 },

  dayHeadRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16, marginBottom: 10 },
  dayHeadLabel: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  dayHeadValue: { color: C.ink3, fontSize: 13 },
  dayRow: { flexDirection: "row", gap: 8 },
  dayChip: {
    flex: 1, aspectRatio: 1, borderRadius: 999, backgroundColor: C.surf,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  dayChipOn: { backgroundColor: C.amber, borderColor: C.amber },
  dayChipText: { color: C.ink2, fontSize: 13, fontWeight: "700" },
  dayChipTextOn: { color: C.onAccent },

  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surf, borderWidth: 1, borderColor: C.border,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 10,
  },
  searchInput: { flex: 1, color: C.ink, fontSize: 15, padding: 0 },
  appRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  check: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: C.ink3,
    alignItems: "center", justifyContent: "center",
  },
  checkOn: { backgroundColor: C.amber, borderColor: C.amber },
  appLabel: { color: C.ink, fontSize: 15, flex: 1 },

  strictRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 16 },
  strictLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  strictLabel: { color: C.ink, fontSize: 14.5, fontWeight: "600" },
  strictHint: { color: C.ink3, fontSize: 12.5, marginTop: 2 },
  proChip: {
    flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderColor: C.glow,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
  },
  proChipText: { color: C.amber, fontSize: 10, fontWeight: "800" },
  toggleTrack: {
    width: 46, height: 27, borderRadius: 999, backgroundColor: C.surf2,
    borderWidth: 1, borderColor: C.border, padding: 2, justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: C.glowFaint, borderColor: C.amber },
  toggleThumb: { width: 21, height: 21, borderRadius: 11, backgroundColor: C.ink3 },
  toggleThumbOn: { backgroundColor: C.amber, alignSelf: "flex-end" },

  commitBtn: {
    borderRadius: 999, paddingVertical: 17, marginTop: 8,
    backgroundColor: C.amber, shadowColor: C.amber, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10,
  },
  commitBtnText: { color: C.onAccent, fontSize: 15.5, fontWeight: "700" },
  deleteBtn: { paddingVertical: 16, alignItems: "center" },
  deleteBtnText: { color: C.red, fontSize: 14, fontWeight: "600" },

  // "New rule" type picker sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.surf, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40,
  },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle: { color: C.ink, fontSize: 17, fontWeight: "700" },
  sheetRow: { flexDirection: "row", gap: 12 },
  typeCard: {
    flex: 1, backgroundColor: C.glass, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    paddingVertical: 20, paddingHorizontal: 10, alignItems: "center", gap: 8,
  },
  typeCardTitle: { color: C.ink, fontSize: 13.5, fontWeight: "700", textAlign: "center" },
  typeCardHint: { color: C.ink3, fontSize: 11, textAlign: "center" },
});
