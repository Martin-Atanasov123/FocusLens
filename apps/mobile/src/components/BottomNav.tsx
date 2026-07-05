/**
 * Persistent bottom navigation (Opal-style): a compact, centered pill with a
 * sliding highlight that glides to the selected tab. Rendered on all three
 * primary surfaces (Home, My Apps, Timer) so it never disappears — switching
 * tabs just slides the indicator instead of flashing the bar in and out.
 *
 * Home / My Apps / Timer are separate screens (Home is the root, the other two
 * are modals), so `onNavigate` is what actually swaps them; this component only
 * owns the animation and the active-state look.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { C } from "../theme";

export type NavTab = "home" | "myapps" | "timer";

const TABS: { key: NavTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "home", label: "Home", icon: "ellipse-outline" },
  { key: "myapps", label: "My Apps", icon: "apps" },
  { key: "timer", label: "Timer", icon: "play" },
];

const TAB_WIDTH = 92;
const PAD = 6;

export default function BottomNav({
  active,
  onNavigate,
}: {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
}) {
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.key === active));
  const slide = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: activeIndex,
      speed: 16,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, slide]);

  const translateX = slide.interpolate({
    inputRange: [0, TABS.length - 1],
    outputRange: [0, TAB_WIDTH * (TABS.length - 1)],
  });

  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.pill}>
        {/* Sliding highlight behind the active tab */}
        <Animated.View
          pointerEvents="none"
          style={[s.indicator, { transform: [{ translateX }] }]}
        />
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <Pressable
              key={t.key}
              style={s.tab}
              onPress={() => onNavigate(t.key)}
              hitSlop={6}
            >
              <Ionicons name={t.icon} size={17} color={on ? C.ink : C.ink3} />
              <Text style={[s.label, on && s.labelOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    backgroundColor: C.navBg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    padding: PAD,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  indicator: {
    position: "absolute",
    top: PAD,
    left: PAD,
    width: TAB_WIDTH,
    bottom: PAD,
    borderRadius: 999,
    backgroundColor: C.glassHi,
    borderWidth: 1,
    borderColor: C.border,
  },
  tab: {
    width: TAB_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  label: { fontSize: 11, color: C.ink3, fontWeight: "500", marginTop: 3 },
  labelOn: { color: C.ink },
});
