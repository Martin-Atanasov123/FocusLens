/**
 * Motion primitives — the app's animation vocabulary in one place.
 *
 * PressableScale — springy scale-down on press (the "professional" tactile
 *   feel every top-tier app has). Drop-in replacement for Pressable.
 * FadeInView — fade + gentle rise on mount, with optional stagger delay.
 *   Use for screen content entrances.
 *
 * Both use the native driver only (transform/opacity), so they stay at 60 fps
 * regardless of JS-thread load.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  ViewStyle,
} from "react-native";

export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: scaleTo,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 20,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable onPressIn={pressIn} onPressOut={pressOut} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * "Hold to Commit" — a long-press button that fills with a progress bar as
 * you hold, and only fires `onCommit` once the hold completes. The friction
 * is deliberate: committing a blocking rule should feel like a decision, not
 * a stray tap (Opal's exact pattern for saving Rules).
 */
export function HoldToCommitButton({
  label,
  onCommit,
  disabled = false,
  holdMs = 650,
  style,
  textStyle,
  fillColor = "rgba(255,255,255,0.35)",
}: {
  label: string;
  onCommit: () => void;
  disabled?: boolean;
  holdMs?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  fillColor?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const [holding, setHolding] = useState(false);

  const reset = useCallback(() => {
    anim.current?.stop();
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
    setHolding(false);
  }, [progress]);

  const start = () => {
    if (disabled) return;
    setHolding(true);
    anim.current = Animated.timing(progress, {
      toValue: 1,
      duration: holdMs,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.current.start(({ finished }) => {
      if (finished) {
        setHolding(false);
        onCommit();
      }
    });
  };

  return (
    <Pressable
      onPressIn={start}
      onPressOut={reset}
      disabled={disabled}
      style={[m.wrap, style, disabled && m.disabled]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          m.fill,
          {
            backgroundColor: fillColor,
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          },
        ]}
      />
      <Text style={textStyle}>{holding ? "Keep holding…" : label}</Text>
    </Pressable>
  );
}

const m = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  disabled: { opacity: 0.5 },
});

export function FadeInView({
  children,
  delay = 0,
  duration = 500,
  rise = 12,
  style,
}: {
  children: React.ReactNode;
  /** Stagger entrance by this many ms. */
  delay?: number;
  duration?: number;
  /** How far the content rises while fading in (px). */
  rise?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(rise)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
