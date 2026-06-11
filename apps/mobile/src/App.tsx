import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking as RNLinking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";

import {
  PairConfig,
  hasUsagePermission,
  loadConfig,
  openUsageAccessSettings,
  saveConfig,
  syncNow,
  todayUsageSeconds,
} from "./sync";

const C = {
  bg: "#F2EDE3",
  surf: "#E9E3D7",
  border: "rgba(24,18,8,0.09)",
  ink: "#1C1610",
  ink2: "#6B6256",
  ink3: "#A8A098",
  amber: "#B26A0A",
  green: "#1D6B3F",
};

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${secs}s`;
}

/** Parse focuslens://pair?url=...&token=... or ?host=&port=&token= */
function parsePairUrl(url: string): PairConfig | null {
  try {
    const { hostname, queryParams } = Linking.parse(url);
    if (hostname !== "pair" || !queryParams) return null;
    const token = String(queryParams.token ?? "");
    const explicit = queryParams.url ? String(queryParams.url) : "";
    if (explicit) return { baseUrl: explicit.replace(/\/+$/, ""), token };
    const host = queryParams.host ? String(queryParams.host) : "";
    if (!host) return null;
    const port = queryParams.port ? String(queryParams.port) : "48732";
    return { baseUrl: `http://${host}:${port}`, token };
  } catch {
    return null;
  }
}

export default function App() {
  const [cfg, setCfg] = useState<PairConfig | null>(null);
  const [permission, setPermission] = useState(false);
  const [usage, setUsage] = useState<{ key: string; label: string; secs: number }[]>([]);
  const [syncState, setSyncState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [manualUrl, setManualUrl] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const perm = await hasUsagePermission();
    setPermission(perm);
    if (perm) {
      try {
        setUsage(await todayUsageSeconds());
      } catch {
        setUsage([]);
      }
    }
  }, []);

  // Initial load + deep link wiring
  useEffect(() => {
    (async () => {
      const saved = await loadConfig();
      if (saved) setCfg(saved);
      const initial = await RNLinking.getInitialURL();
      if (initial) {
        const pc = parsePairUrl(initial);
        if (pc) {
          await saveConfig(pc);
          setCfg(pc);
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
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Auto-sync on app open when already paired + permitted
  useEffect(() => {
    if (cfg && permission) {
      syncNow().catch(() => {});
    }
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

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={C.amber} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <Text style={s.logo}>
        Focus<Text style={s.logoEm}>Lens</Text>
      </Text>
      <Text style={s.tag}>Android companion</Text>

      {/* Step 1: usage permission */}
      <View style={s.card}>
        <Text style={s.cardTitle}>
          {permission ? "✓ Usage access granted" : "1 · Grant usage access"}
        </Text>
        {!permission && (
          <>
            <Text style={s.cardBody}>
              FocusLens needs the “Usage access” permission to read app screen
              time. Find FocusLens in the list and enable it.
            </Text>
            <Pressable style={s.btn} onPress={openUsageAccessSettings}>
              <Text style={s.btnText}>Open settings →</Text>
            </Pressable>
            <Pressable style={s.btnGhost} onPress={refresh}>
              <Text style={s.btnGhostText}>I granted it — re-check</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Step 2: pairing */}
      <View style={s.card}>
        <Text style={s.cardTitle}>
          {cfg ? "✓ Paired with desktop" : "2 · Pair with your desktop"}
        </Text>
        {cfg ? (
          <Text style={s.cardBody} numberOfLines={1}>
            {cfg.baseUrl}
          </Text>
        ) : (
          <>
            <Text style={s.cardBody}>
              Easiest: open the desktop dashboard → Settings → Show QR → “Pair
              app”, then scan with your camera. Or enter manually:
            </Text>
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
            <Pressable style={s.btn} onPress={savePairing}>
              <Text style={s.btnText}>Save</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Sync + today's usage */}
      {cfg && permission && (
        <>
          <Pressable style={s.btn} onPress={doSync} disabled={syncState === "busy"}>
            <Text style={s.btnText}>
              {syncState === "busy"
                ? "Syncing…"
                : syncState === "ok"
                ? "✓ Synced"
                : syncState === "fail"
                ? "✗ Could not reach desktop"
                : "Sync now"}
            </Text>
          </Pressable>
          <Text style={s.note}>Auto-syncs in the background every ~15 min.</Text>

          <Text style={s.listHeader}>TODAY ON THIS PHONE</Text>
          <FlatList
            data={usage.slice(0, 15)}
            keyExtractor={(i) => i.key}
            onRefresh={refresh}
            refreshing={false}
            renderItem={({ item }) => (
              <View style={s.row}>
                <Text style={s.rowLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={s.rowVal}>{fmt(item.secs)}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text style={s.note}>No usage recorded yet today.</Text>
            }
          />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 64, paddingHorizontal: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 26, color: C.ink, fontWeight: "300", letterSpacing: -0.5 },
  logoEm: { fontStyle: "italic", color: C.amber },
  tag: { fontSize: 12, color: C.ink3, marginBottom: 20 },
  card: {
    backgroundColor: C.surf,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: "600", color: C.ink, marginBottom: 6 },
  cardBody: { fontSize: 12.5, color: C.ink2, lineHeight: 18, marginBottom: 10 },
  btn: {
    backgroundColor: C.ink,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  btnText: { color: C.bg, fontSize: 13.5, fontWeight: "600" },
  btnGhost: { paddingVertical: 10, alignItems: "center" },
  btnGhostText: { color: C.ink2, fontSize: 12.5 },
  input: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: C.ink,
    marginBottom: 8,
  },
  note: { fontSize: 11, color: C.ink3, textAlign: "center", marginVertical: 8 },
  listHeader: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: C.ink3,
    marginTop: 16,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
  },
  rowLabel: { fontSize: 13.5, color: C.ink, flex: 1, marginRight: 12 },
  rowVal: { fontSize: 12.5, color: C.ink2, fontVariant: ["tabular-nums"] },
});
