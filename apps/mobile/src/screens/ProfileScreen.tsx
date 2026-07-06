/**
 * Profile — streak, focus stats and the Gemstones grid (Opal-style).
 * Pure presentation over local gamification state; no server involved.
 */
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { C } from "../theme";
import { getBlockEventCount, getLimits } from "../blocking/FocusBlocker";
import {
  computeGems,
  FocusTotals,
  Gem,
  getStreak,
  getTotals,
  Streak,
} from "../gamification/streaks";
import { getScoreHistory } from "../gamification/score";

type DayScore = { label: string; score: number | null; isToday: boolean };

const DOW = ["S", "M", "T", "W", "T", "F", "S"]; // JS getDay(): 0=Sun

/** Build the last 7 calendar days (oldest→today) from the stored history map. */
function lastSevenDays(history: Record<string, number>): DayScore[] {
  const out: DayScore[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({
      label: DOW[d.getDay()],
      score: key in history ? history[key] : null,
      isToday: i === 0,
    });
  }
  return out;
}

export default function ProfileScreen({
  visible,
  onClose,
  userName,
}: {
  visible: boolean;
  onClose: () => void;
  userName: string;
}) {
  const [streak, setStreak] = useState<Streak>({ current: 0, best: 0, lastGoodDay: "" });
  const [totals, setTotals] = useState<FocusTotals>({ sessions: 0, minutes: 0 });
  const [gems, setGems] = useState<Gem[]>([]);
  const [week, setWeek] = useState<DayScore[]>([]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const [st, tot, hist] = await Promise.all([
        getStreak(),
        getTotals(),
        getScoreHistory(),
      ]);
      setStreak(st);
      setTotals(tot);
      setWeek(lastSevenDays(hist));
      setGems(
        computeGems({
          totals: tot,
          streak: st,
          limitsCount: getLimits().length,
          blockEventCount: getBlockEventCount(),
        })
      );
    })();
  }, [visible]);

  const focusHours = Math.floor(totals.minutes / 60);
  const unlockedCount = gems.filter((g) => g.unlocked).length;

  const weekScores = week.filter((d) => d.score != null).map((d) => d.score as number);
  const weekAvg =
    weekScores.length > 0
      ? Math.round(weekScores.reduce((a, b) => a + b, 0) / weekScores.length)
      : null;
  const barColor = (v: number) => (v >= 80 ? C.amber : v >= 50 ? C.flame : C.red);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.back}>‹ Close</Text>
          </Pressable>
          <View style={{ width: 52 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Avatar + name */}
          <View style={s.head}>
            <View style={s.avatar}>
              <Ionicons name="person" size={30} color={C.amber} />
            </View>
            <Text style={s.name}>{userName || "Focused human"}</Text>
          </View>

          {/* Stats row: focus hours · streak · gems */}
          <View style={s.statsRow}>
            <View style={s.statCol}>
              <Ionicons name="hourglass-outline" size={22} color={C.ink2} />
              <Text style={s.statNum}>{focusHours}</Text>
              <Text style={s.statLabel}>FOCUS HOURS</Text>
            </View>
            <View style={s.statCol}>
              <Ionicons
                name="flame"
                size={22}
                color={streak.current > 0 ? C.flame : C.ink3}
              />
              <Text style={s.statNum}>{streak.current}</Text>
              <Text style={s.statLabel}>DAY STREAK</Text>
            </View>
            <View style={s.statCol}>
              <Ionicons name="diamond-outline" size={22} color={C.amber} />
              <Text style={s.statNum}>{unlockedCount}</Text>
              <Text style={s.statLabel}>GEMS</Text>
            </View>
          </View>

          {streak.best > 0 && (
            <Text style={s.bestNote}>
              Best streak: {streak.best} day{streak.best === 1 ? "" : "s"} ·{" "}
              {totals.sessions} session{totals.sessions === 1 ? "" : "s"} completed
            </Text>
          )}

          {/* This week — Focus Score history */}
          <View style={s.weekHead}>
            <Text style={s.sectionTitle}>This week</Text>
            {weekAvg != null && (
              <View style={s.avgPill}>
                <Text style={s.avgPillText}>avg {weekAvg}</Text>
              </View>
            )}
          </View>
          <View style={s.chartCard}>
            <View style={s.chart}>
              {week.map((d, i) => (
                <View key={i} style={s.barCol}>
                  <View style={s.barTrack}>
                    {d.score != null ? (
                      <View
                        style={[
                          s.barFill,
                          {
                            height: `${Math.max(4, d.score)}%`,
                            backgroundColor: barColor(d.score),
                          },
                          d.isToday && s.barToday,
                        ]}
                      />
                    ) : (
                      <View style={s.barEmpty} />
                    )}
                  </View>
                  <Text style={[s.barVal, d.score == null && s.barValMuted]}>
                    {d.score != null ? d.score : "–"}
                  </Text>
                  <Text style={[s.barDay, d.isToday && s.barDayToday]}>{d.label}</Text>
                </View>
              ))}
            </View>
            {weekAvg == null && (
              <Text style={s.chartEmpty}>
                Your history builds day by day — check back tomorrow. 🌱
              </Text>
            )}
          </View>

          {/* Gemstones */}
          <Text style={s.sectionTitle}>Gemstones</Text>
          <View style={s.gemGrid}>
            {gems.map((g) => (
              <View key={g.id} style={[s.gemCard, g.unlocked && s.gemCardOn]}>
                <View style={[s.gemIconWrap, g.unlocked && s.gemIconWrapOn]}>
                  <Ionicons
                    // Gem icons come from our own catalog — always valid Ionicons names.
                    name={g.icon as keyof typeof Ionicons.glyphMap}
                    size={26}
                    color={g.unlocked ? C.amber : C.ink3}
                  />
                </View>
                <Text style={[s.gemName, g.unlocked && s.gemNameOn]}>{g.name}</Text>
                <Text style={s.gemHint} numberOfLines={2}>
                  {g.unlocked ? "Unlocked" : g.hint}
                </Text>
              </View>
            ))}
          </View>

          <Text style={s.footNote}>
            Complete a focus session to keep your streak alive. 🔥
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 52 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { color: C.amber, fontSize: 16 },

  head: { alignItems: "center", marginTop: 12, marginBottom: 28 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: C.glass,
    borderWidth: 2,
    borderColor: C.glow,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.amber,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  name: { color: C.ink, fontSize: 24, fontWeight: "700", marginTop: 14 },

  statsRow: { flexDirection: "row", marginBottom: 10 },
  statCol: { flex: 1, alignItems: "center", gap: 6 },
  statNum: {
    color: C.ink,
    fontSize: 32,
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
  },
  statLabel: { color: C.ink3, fontSize: 10, letterSpacing: 1.5, fontWeight: "600" },
  bestNote: { color: C.ink3, fontSize: 12.5, textAlign: "center", marginTop: 6 },

  sectionTitle: { color: C.ink, fontSize: 18, fontWeight: "700", marginTop: 32, marginBottom: 14 },

  // weekly score chart
  weekHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  avgPill: {
    backgroundColor: C.glowFaint,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 24,
  },
  avgPillText: { color: C.amber, fontSize: 12.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chartCard: {
    backgroundColor: C.glass,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
  },
  chart: { flexDirection: "row", alignItems: "flex-end", height: 140, gap: 8 },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: {
    width: "100%",
    height: 104,
    backgroundColor: C.surf,
    borderRadius: 8,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { width: "100%", borderRadius: 8 },
  barToday: { shadowColor: C.amber, shadowOpacity: 0.7, shadowRadius: 10, elevation: 6 },
  barEmpty: { width: "100%", height: 3, backgroundColor: C.border },
  barVal: {
    color: C.ink2,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
    fontVariant: ["tabular-nums"],
  },
  barValMuted: { color: C.ink3, fontWeight: "400" },
  barDay: { color: C.ink3, fontSize: 11, marginTop: 2 },
  barDayToday: { color: C.amber, fontWeight: "700" },
  chartEmpty: { color: C.ink3, fontSize: 12.5, textAlign: "center", marginTop: 14 },

  gemGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gemCard: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: C.glass,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    alignItems: "center",
  },
  gemCardOn: {
    borderColor: C.glow,
    backgroundColor: C.glowFaint,
  },
  gemIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.surf,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  gemIconWrapOn: {
    backgroundColor: C.glowFaint,
    shadowColor: C.amber,
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 8,
  },
  gemName: { color: C.ink2, fontSize: 14, fontWeight: "700" },
  gemNameOn: { color: C.ink },
  gemHint: { color: C.ink3, fontSize: 11.5, textAlign: "center", marginTop: 4, lineHeight: 15 },

  footNote: { color: C.ink3, fontSize: 12.5, textAlign: "center", marginVertical: 28 },
});
