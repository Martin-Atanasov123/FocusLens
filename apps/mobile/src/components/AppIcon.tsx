/**
 * Real launcher icons (Opal-style) with a graceful fallback.
 *
 * `useAppIcons(pkgs)` batch-fetches base64 icons from the native module and
 * caches them for the app's lifetime — icons don't change mid-session, and the
 * cache keeps list re-renders instant.
 *
 * `<AppIcon>` renders the icon as a rounded tile; when the icon is missing
 * (system app without a launcher icon, web preview) it falls back to a letter
 * tile in the theme's mint.
 */
import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { C } from "../theme";
import { getAppIcons } from "../blocking/FocusBlocker";

const cache = new Map<string, string | null>();

/** Batch-load icons for `packageNames`; returns pkg → data-URI as they arrive. */
export function useAppIcons(packageNames: string[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const key = packageNames.join(",");

  useEffect(() => {
    let alive = true;
    const missing = packageNames.filter((p) => !cache.has(p));

    const applyFromCache = () => {
      const out: Record<string, string> = {};
      packageNames.forEach((p) => {
        const uri = cache.get(p);
        if (uri) out[p] = uri;
      });
      if (alive) setIcons(out);
    };

    if (missing.length === 0) {
      applyFromCache();
      return;
    }
    getAppIcons(missing).then((fetched) => {
      missing.forEach((p) => cache.set(p, fetched[p] ?? null));
      applyFromCache();
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return icons;
}

export function AppIcon({
  uri,
  label,
  size = 40,
  locked = false,
}: {
  /** data-URI from useAppIcons, or undefined for the fallback tile. */
  uri?: string;
  label: string;
  size?: number;
  /** Dim the icon and overlay a lock (blocked apps, Opal-style). */
  locked?: boolean;
}) {
  const radius = size * 0.3;
  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            opacity: locked ? 0.45 : 1,
          }}
        />
      ) : (
        <View
          style={[
            s.fallback,
            { width: size, height: size, borderRadius: radius, opacity: locked ? 0.45 : 1 },
          ]}
        >
          <Text style={[s.fallbackText, { fontSize: size * 0.42 }]}>
            {(label || "?").charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      {locked && (
        <View style={s.lockWrap}>
          <Ionicons name="lock-closed" size={size * 0.4} color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fallback: {
    backgroundColor: C.glowFaint,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: { color: C.amber, fontWeight: "700" },
  lockWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
