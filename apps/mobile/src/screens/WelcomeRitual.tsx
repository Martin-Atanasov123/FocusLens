/**
 * Welcome ritual — the cinematic first-open sequence (Opal-style).
 *
 * Runs once, right after onboarding completes. A glowing orb, the user's
 * name, then the three pillars light up one by one, ending with the Focus
 * Score counting up to 100. This is the "peak" moment of the first session:
 * it explains the score (the retention metric) and makes it feel owned.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

import { C, CTA_GRADIENT } from "../theme";

type Phase = "intro" | "pillar1" | "pillar2" | "pillar3" | "score" | "done";

const PILLARS = [
  { icon: "phone-portrait-outline" as const, label: "Screen", caption: "We watch how much your phone pulls you in." },
  { icon: "hourglass-outline" as const, label: "Focus", caption: "How deeply you focus when it matters." },
  { icon: "shield-half-outline" as const, label: "Limits", caption: "And whether you keep the limits you set." },
];

const PHASE_ORDER: Phase[] = ["intro", "pillar1", "pillar2", "pillar3", "score", "done"];
const AUTO_ADVANCE_MS = 2400;

export default function WelcomeRitual({
  name,
  onDone,
}: {
  name: string;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [scoreShown, setScoreShown] = useState(0);

  const captionFade = useRef(new Animated.Value(0)).current;
  const orbScale = useRef(new Animated.Value(0.85)).current;
  const glowPulse = useRef(new Animated.Value(0.5)).current;

  // Orb entrance + endless breathing.
  useEffect(() => {
    Animated.timing(orbScale, {
      toValue: 1,
      duration: 1200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(orbScale, { toValue: 1.05, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      ).start();
    });
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0.5, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, [orbScale, glowPulse]);

  // Crossfade the caption whenever the phase changes.
  useEffect(() => {
    captionFade.setValue(0);
    Animated.timing(captionFade, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [phase, captionFade]);

  const advance = useCallback(() => {
    setPhase((p) => {
      const i = PHASE_ORDER.indexOf(p);
      return PHASE_ORDER[Math.min(i + 1, PHASE_ORDER.length - 1)];
    });
  }, []);

  // Pillar phases advance on their own (tap skips ahead).
  useEffect(() => {
    if (phase === "pillar1" || phase === "pillar2" || phase === "pillar3") {
      const t = setTimeout(advance, AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, advance]);

  // Score counts 0 → 100 with an ease-out curve, then reveals the CTA.
  useEffect(() => {
    if (phase !== "score") return;
    const startTs = Date.now();
    const DURATION = 1400;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - startTs) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setScoreShown(Math.round(eased * 100));
      if (t >= 1) {
        clearInterval(id);
        setTimeout(() => setPhase("done"), 900);
      }
    }, 16);
    return () => clearInterval(id);
  }, [phase]);

  const pillarActive =
    phase === "pillar1" ? 0 : phase === "pillar2" ? 1 : phase === "pillar3" ? 2 : -1;
  const showPillars = pillarActive >= 0 || phase === "score" || phase === "done";
  const showScore = phase === "score" || phase === "done";

  const caption =
    phase === "intro"
      ? `${name ? name + ", a" : "A"}ttention is your most valuable asset.`
      : pillarActive >= 0
      ? PILLARS[pillarActive].caption
      : phase === "score"
      ? "This is your Focus Score."
      : "It starts perfect. Protect it.";

  return (
    <Pressable style={s.root} onPress={pillarActive >= 0 ? advance : undefined}>
      <StatusBar style="light" />

      {/* Orb */}
      <View style={s.orbZone}>
        <Animated.View style={[s.orbGlow, { opacity: glowPulse, transform: [{ scale: orbScale }] }]} />
        <Animated.View style={{ transform: [{ scale: orbScale }] }}>
          <LinearGradient
            colors={["#D8FBE8", "#A9EEC8", "#55B983"]}
            start={{ x: 0.2, y: 0.1 }}
            end={{ x: 0.85, y: 1 }}
            style={s.orb}
          />
        </Animated.View>
      </View>

      {/* Score (revealed near the end) */}
      {showScore && (
        <View style={s.scoreWrap}>
          <Text style={s.scoreEye}>SCORE</Text>
          <Text style={s.scoreNum}>{scoreShown}</Text>
        </View>
      )}

      {/* Pillars */}
      {showPillars && (
        <View style={s.pillRow}>
          {PILLARS.map((p, i) => {
            const active = i === pillarActive || showScore;
            return (
              <View key={p.label} style={s.pillCol}>
                <View style={[s.pill, active && s.pillActive]}>
                  <Ionicons
                    name={p.icon}
                    size={20}
                    color={active ? C.amber : C.ink3}
                  />
                </View>
                <Text style={[s.pillLabel, active && s.pillLabelActive]}>
                  {p.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Caption */}
      <Animated.Text style={[s.caption, { opacity: captionFade }]}>
        {caption}
      </Animated.Text>

      {/* CTA */}
      {phase === "intro" && (
        <Pressable onPress={advance} style={s.ctaWrap}>
          <LinearGradient
            colors={[...CTA_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.cta}
          >
            <Text style={s.ctaText}>Continue</Text>
          </LinearGradient>
        </Pressable>
      )}
      {phase === "done" && (
        <Pressable onPress={onDone} style={s.ctaWrap}>
          <LinearGradient
            colors={[...CTA_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.cta}
          >
            <Text style={s.ctaText}>Enter FocusLens</Text>
          </LinearGradient>
        </Pressable>
      )}
      {pillarActive >= 0 && <Text style={s.skipHint}>tap to continue</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  orbZone: {
    height: 280,
    marginTop: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  orbGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: C.glowFaint,
    shadowColor: C.amber,
    shadowOpacity: 0.8,
    shadowRadius: 60,
    elevation: 30,
  },
  orb: {
    width: 150,
    height: 150,
    borderRadius: 75,
    shadowColor: C.amber,
    shadowOpacity: 0.9,
    shadowRadius: 40,
    elevation: 20,
  },

  scoreWrap: { alignItems: "center", marginTop: 8 },
  scoreEye: { fontSize: 11, letterSpacing: 3, color: C.amber, fontWeight: "700" },
  scoreNum: {
    fontSize: 64,
    fontWeight: "200",
    color: C.amber,
    letterSpacing: -2,
    lineHeight: 70,
    fontVariant: ["tabular-nums"],
  },

  pillRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    marginTop: 20,
  },
  pillCol: { alignItems: "center" },
  pill: {
    width: 84,
    height: 50,
    borderRadius: 999,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: {
    borderStyle: "solid",
    borderColor: C.amber,
    backgroundColor: C.glowFaint,
    shadowColor: C.amber,
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 10,
  },
  pillLabel: { fontSize: 13, color: C.ink3, marginTop: 8, fontWeight: "500" },
  pillLabelActive: { color: C.amber },

  caption: {
    fontSize: 21,
    color: C.ink,
    textAlign: "center",
    lineHeight: 30,
    marginTop: "auto",
    marginBottom: 28,
    fontWeight: "500",
  },

  ctaWrap: { alignSelf: "stretch" },
  cta: {
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.glow,
  },
  ctaText: { color: C.ink, fontSize: 16, fontWeight: "700" },
  skipHint: { fontSize: 12, color: C.ink3, marginTop: 14 },
});
