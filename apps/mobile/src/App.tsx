import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking as RNLinking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { CameraView, useCameraPermissions } from "expo-camera";

import {
  PairConfig,
  hasUsagePermission,
  loadConfig,
  openUsageAccessSettings,
  pingDesktop,
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
  red: "#B5280A",
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

  // QR scanner
  const [scanning, setScanning] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scanLock = useRef(false);

  // Connection indicator: null = not paired, true = reachable, false = offline
  const [connected, setConnected] = useState<boolean | null>(null);

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

  // Connection heartbeat: ping the desktop every 5s while paired
  useEffect(() => {
    if (!cfg) {
      setConnected(null);
      return;
    }
    let alive = true;
    const check = async () => {
      const ok = await pingDesktop(cfg.baseUrl);
      if (alive) setConnected(ok);
    };
    check();
    const id = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cfg]);

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

  const startScan = useCallback(async () => {
    if (!camPerm?.granted) {
      const res = await requestCamPerm();
      if (!res.granted) return;
    }
    scanLock.current = false;
    setScanning(true);
  }, [camPerm, requestCamPerm]);

  const onScanned = useCallback(async ({ data }: { data: string }) => {
    if (scanLock.current) return;
    const pc = parsePairUrl(data);
    if (pc) {
      scanLock.current = true;
      setScanning(false);
      await saveConfig(pc);
      setCfg(pc);
    }
  }, []);

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={C.amber} />
      </View>
    );
  }

  const statusColor =
    connected === true ? C.green : connected === false ? C.red : C.ink3;
  const statusText =
    connected === true
      ? "Connected to desktop"
      : connected === false
      ? "Desktop unreachable"
      : "Not paired yet";

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <Text style={s.logo}>
        Focus<Text style={s.logoEm}>Lens</Text>
      </Text>
      <Text style={s.tag}>Android companion</Text>

      {/* Connection indicator */}
      <View style={s.statusRow}>
        <View style={[s.statusDot, { backgroundColor: statusColor }]} />
        <Text style={s.statusText}>{statusText}</Text>
      </View>

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
            <Pressable
              style={s.btn}
              onPress={() => {
                openUsageAccessSettings().catch(() => {});
              }}
            >
              <Text style={s.btnText}>Open Usage Access settings →</Text>
            </Pressable>
            <Text style={s.cardBody}>
              {"There is no popup for this — Android requires it to be toggled once by hand.\n\nXiaomi path if the button doesn't land you there:\nSettings → Apps → Manage apps → FocusLens → Other permissions → View usage data → Enable"}
            </Text>
            <Pressable style={s.btnGhost} onPress={refresh}>
              <Text style={s.btnGhostText}>I enabled it — re-check</Text>
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
          <>
            <Text style={s.cardBody} numberOfLines={1}>
              {cfg.baseUrl}
            </Text>
            <Pressable style={s.btnGhost} onPress={startScan}>
              <Text style={s.btnGhostText}>Re-pair / scan a different QR</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.cardBody}>
              On the desktop: Settings → Show QR → “Pair app”, then scan it here.
            </Text>
            <Pressable style={s.btn} onPress={startScan}>
              <Text style={s.btnText}>📷 Scan QR code</Text>
            </Pressable>
            <Text style={s.orText}>— or enter manually —</Text>
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
            <Pressable style={s.btnGhost} onPress={savePairing}>
              <Text style={s.btnGhostText}>Save manual pairing</Text>
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
          <Text style={s.note}>Syncs automatically each time you open the app.</Text>

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

      {/* QR scanner modal */}
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={s.scanRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />
          <View style={s.scanFrame} />
          <Text style={s.scanHint}>Point at the “Pair app” QR on your desktop</Text>
          <Pressable style={s.scanCancel} onPress={() => setScanning(false)}>
            <Text style={s.btnText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 64, paddingHorizontal: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 26, color: C.ink, fontWeight: "300", letterSpacing: -0.5 },
  logoEm: { fontStyle: "italic", color: C.amber },
  tag: { fontSize: 12, color: C.ink3, marginBottom: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  statusText: { fontSize: 12.5, color: C.ink2, fontWeight: "500" },
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
  orText: { fontSize: 11, color: C.ink3, textAlign: "center", marginVertical: 10 },
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
  // scanner
  scanRoot: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  scanFrame: {
    width: 240,
    height: 240,
    borderColor: "#fff",
    borderWidth: 3,
    borderRadius: 20,
    backgroundColor: "transparent",
  },
  scanHint: {
    position: "absolute",
    top: 90,
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 30,
  },
  scanCancel: {
    position: "absolute",
    bottom: 60,
    backgroundColor: "rgba(28,22,16,0.85)",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
});
