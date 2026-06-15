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
import { WebView } from "react-native-webview";

import {
  PairConfig,
  hasUsagePermission,
  loadConfig,
  openUsageAccessSettings,
  refreshRemoteUrl,
  resolveBaseUrl,
  saveConfig,
  syncNow,
  todayUsageSeconds,
} from "./sync";

const C = {
  bg: "#F2EDE3",
  surf: "#E9E3D7",
  surf2: "#E0D9CB",
  border: "rgba(24,18,8,0.09)",
  ink: "#1C1610",
  ink2: "#6B6256",
  ink3: "#A8A098",
  amber: "#B26A0A",
  green: "#1D6B3F",
  red: "#B5280A",
};

type UsageRow = { key: string; label: string; secs: number };

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${secs}s`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
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
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [syncState, setSyncState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [manualUrl, setManualUrl] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDesktop, setShowDesktop] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  // QR scanner
  const [scanning, setScanning] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scanLock = useRef(false);

  // Connection indicator: null = not paired, true = reachable, false = offline
  const [connected, setConnected] = useState<boolean | null>(null);
  // The currently reachable URL (LAN or tunnel), resolved by the heartbeat.
  const [activeBase, setActiveBase] = useState<string | null>(null);

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
          setShowDesktop(true);
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
        setShowDesktop(true);
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Refresh local usage periodically while the app is open
  useEffect(() => {
    if (!permission) return;
    const id = setInterval(() => {
      todayUsageSeconds()
        .then(setUsage)
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [permission]);

  // Connection heartbeat: resolve a reachable URL (LAN → tunnel) every 5s.
  useEffect(() => {
    if (!cfg) {
      setConnected(null);
      setActiveBase(null);
      return;
    }
    let alive = true;
    const check = async () => {
      const base = await resolveBaseUrl(cfg);
      if (!alive) return;
      setConnected(!!base);
      setActiveBase(base);
    };
    check();
    const id = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cfg]);

  // On open: learn the current tunnel URL (while on LAN), then sync.
  useEffect(() => {
    if (!cfg || !permission) return;
    (async () => {
      const updated = await refreshRemoteUrl(cfg);
      if (updated.remoteUrl !== cfg.remoteUrl) setCfg(updated);
      syncNow().catch(() => {});
    })();
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

  // ---- Permission gate: nothing works without usage access ----------------
  if (!permission) {
    return (
      <View style={s.root}>
        <StatusBar style="dark" />
        <Text style={s.logo}>
          Focus<Text style={s.logoEm}>Lens</Text>
        </Text>
        <Text style={s.tag}>Screen time for your phone</Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>1 · Allow restricted settings</Text>
          <Text style={s.cardBody}>
            Because FocusLens was installed from an APK (not the Play Store),
            Android blocks sensitive permissions until you unlock them once.
            {"\n\n"}Settings → Apps → Manage apps → FocusLens → tap ⋮ (top-right)
            → “Allow restricted settings”.
            {"\n\n"}If you don't see that menu item, you can skip straight to
            step 2 — some phones don't need it.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>2 · Grant usage access</Text>
          <Text style={s.cardBody}>
            This is what lets FocusLens read your per-app screen time. There is
            no popup — it's a one-time manual toggle.
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
            {"Xiaomi path if the button doesn't land you there:\nSettings → Apps → Manage apps → FocusLens → Other permissions → View usage data → Enable"}
          </Text>
          <Pressable style={s.btnGhost} onPress={refresh}>
            <Text style={s.btnGhostText}>I enabled it — re-check</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Standalone view: phone screen time is the main content -------------
  const totalSecs = usage.reduce((a, u) => a + u.secs, 0);
  const statusColor =
    connected === true ? C.green : connected === false ? C.red : C.ink3;
  const statusText =
    connected === true
      ? "Connected to desktop"
      : connected === false
      ? "Desktop unreachable"
      : "Not connected";

  const header = (
    <View>
      <Text style={s.logo}>
        Focus<Text style={s.logoEm}>Lens</Text>
      </Text>
      <Text style={s.tag}>Screen time for your phone</Text>

      <Text style={s.heroEye}>TOTAL · TODAY</Text>
      <Text style={s.heroNum}>{fmt(totalSecs)}</Text>
      <Text style={s.heroDate}>{todayStr()}</Text>

      <View style={s.sectionRule}>
        <Text style={s.sectionLabel}>APPS</Text>
      </View>
    </View>
  );

  const footer = (
    <View style={s.optWrap}>
      {!showDesktop ? (
        <Pressable style={s.optToggle} onPress={() => setShowDesktop(true)}>
          <View style={[s.statusDot, { backgroundColor: cfg ? statusColor : C.ink3 }]} />
          <Text style={s.optToggleText}>
            {cfg ? statusText : "Connect to a desktop (optional)"}
          </Text>
          <Text style={s.optChevron}>⌄</Text>
        </Pressable>
      ) : (
        <View style={s.optCard}>
          <View style={s.optHead}>
            <Text style={s.optLabel}>OPTIONAL · DESKTOP SYNC</Text>
            <Pressable onPress={() => setShowDesktop(false)}>
              <Text style={s.optHide}>hide</Text>
            </Pressable>
          </View>

          <View style={s.statusRow}>
            <View style={[s.statusDot, { backgroundColor: cfg ? statusColor : C.ink3 }]} />
            <Text style={s.statusText}>{cfg ? statusText : "Not connected"}</Text>
          </View>

          {cfg ? (
            <>
              <Text style={s.cardBody} numberOfLines={1}>
                {activeBase || cfg.baseUrl}
                {activeBase && activeBase === cfg.remoteUrl ? " · via tunnel" : ""}
              </Text>
              {connected === true && (
                <Pressable style={s.btn} onPress={() => setDashboardOpen(true)}>
                  <Text style={s.btnText}>🖥️ Open full dashboard</Text>
                </Pressable>
              )}
              <Pressable style={s.btnAlt} onPress={doSync} disabled={syncState === "busy"}>
                <Text style={s.btnAltText}>
                  {syncState === "busy"
                    ? "Syncing…"
                    : syncState === "ok"
                    ? "✓ Synced to desktop"
                    : syncState === "fail"
                    ? "✗ Could not reach desktop"
                    : "Sync now"}
                </Text>
              </Pressable>
              {(syncState === "fail" || connected === false) && (
                <Text style={s.failHint}>
                  {"Phone can't reach the computer. Check:\n• Both on the same Wi-Fi\n• Desktop FocusLens is running\n• On the PC, run allow-phone-access.bat as admin (opens the firewall)"}
                </Text>
              )}
              <Pressable style={s.btnGhost} onPress={startScan}>
                <Text style={s.btnGhostText}>Re-pair / scan a different QR</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.cardBody}>
                Send this phone's usage to the FocusLens desktop app so you see
                phone + computer time together. Desktop → Settings → Show QR →
                “Pair app”.
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
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <FlatList
        data={usage.slice(0, 30)}
        keyExtractor={(i) => i.key}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onRefresh={refresh}
        refreshing={false}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const max = usage[0]?.secs || 1;
          return (
            <View style={s.row}>
              <View style={s.rowLeft}>
                <Text style={s.rowLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${(item.secs / max) * 100}%` }]} />
                </View>
              </View>
              <Text style={s.rowVal}>{fmt(item.secs)}</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={s.note}>No app usage recorded yet today.</Text>
        }
      />

      {/* Full desktop dashboard in a WebView */}
      <Modal
        visible={dashboardOpen}
        animationType="slide"
        onRequestClose={() => setDashboardOpen(false)}
      >
        <View style={s.webRoot}>
          <View style={s.webBar}>
            <Pressable onPress={() => setDashboardOpen(false)} hitSlop={12}>
              <Text style={s.webBack}>‹ Back</Text>
            </Pressable>
            <Text style={s.webTitle}>FocusLens · full dashboard</Text>
            <View style={{ width: 48 }} />
          </View>
          {cfg && (
            <WebView
              source={{
                uri:
                  (activeBase || cfg.baseUrl) +
                  "/?token=" +
                  encodeURIComponent(cfg.token),
              }}
              style={{ flex: 1, backgroundColor: C.bg }}
              originWhitelist={["*"]}
            />
          )}
        </View>
      </Modal>

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
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 60, paddingHorizontal: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 26, color: C.ink, fontWeight: "300", letterSpacing: -0.5 },
  logoEm: { fontStyle: "italic", color: C.amber },
  tag: { fontSize: 12, color: C.ink3, marginBottom: 24 },

  // hero
  heroEye: { fontSize: 10, letterSpacing: 2, color: C.ink3, marginBottom: 6 },
  heroNum: { fontSize: 64, fontWeight: "200", color: C.ink, letterSpacing: -2, lineHeight: 68 },
  heroDate: { fontSize: 13, color: C.ink2, marginTop: 4, fontVariant: ["tabular-nums"] },
  sectionRule: { marginTop: 28, marginBottom: 8, borderTopColor: C.border, borderTopWidth: 1, paddingTop: 14 },
  sectionLabel: { fontSize: 10, letterSpacing: 2, color: C.ink3 },

  // app rows
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  rowLeft: { flex: 1, marginRight: 14 },
  rowLabel: { fontSize: 14, color: C.ink, marginBottom: 6 },
  barTrack: { height: 3, backgroundColor: C.surf2, borderRadius: 99, overflow: "hidden" },
  barFill: { height: 3, backgroundColor: C.amber, borderRadius: 99 },
  rowVal: { fontSize: 13, color: C.ink2, fontVariant: ["tabular-nums"], minWidth: 56, textAlign: "right" },
  note: { fontSize: 12, color: C.ink3, textAlign: "center", paddingVertical: 24 },

  // cards (permission + optional desktop)
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
  btn: { backgroundColor: C.ink, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  btnText: { color: C.bg, fontSize: 13.5, fontWeight: "600" },
  btnAlt: { backgroundColor: C.surf2, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnAltText: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  btnGhost: { paddingVertical: 10, alignItems: "center" },
  btnGhostText: { color: C.ink2, fontSize: 12.5 },
  failHint: { fontSize: 11.5, color: C.red, lineHeight: 17, marginTop: 10 },
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

  // optional desktop section
  optWrap: { marginTop: 24, marginBottom: 40 },
  optToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surf,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optToggleText: { flex: 1, fontSize: 13, color: C.ink2, marginLeft: 10 },
  optChevron: { fontSize: 16, color: C.ink3 },
  optCard: {
    backgroundColor: C.surf,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  optHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  optLabel: { fontSize: 10, letterSpacing: 1.5, color: C.ink3 },
  optHide: { fontSize: 12, color: C.ink3 },
  statusRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { fontSize: 12.5, color: C.ink2, fontWeight: "500", marginLeft: 8 },

  // full dashboard webview
  webRoot: { flex: 1, backgroundColor: C.bg, paddingTop: 40 },
  webBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
  },
  webBack: { fontSize: 15, color: C.amber, fontWeight: "600", width: 48 },
  webTitle: { fontSize: 13, color: C.ink2, fontWeight: "500" },

  // scanner
  scanRoot: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  scanFrame: { width: 240, height: 240, borderColor: "#fff", borderWidth: 3, borderRadius: 20, backgroundColor: "transparent" },
  scanHint: { position: "absolute", top: 90, color: "#fff", fontSize: 14, textAlign: "center", paddingHorizontal: 30 },
  scanCancel: { position: "absolute", bottom: 60, backgroundColor: "rgba(28,22,16,0.85)", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 40 },
});
