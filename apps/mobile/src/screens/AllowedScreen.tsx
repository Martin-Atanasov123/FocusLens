/**
 * Always Allowed — a global whitelist of apps that are NEVER blocked, whatever
 * rules/limits/sessions say (Opal's "Always Allowed Apps"). Lets essentials
 * (phone, maps, messages) stay usable even mid-focus-session.
 *
 * Writes the whole set at save time via the native bridge; the service reads it
 * from SharedPreferences and short-circuits before any block check.
 */
import React, { useEffect, useState } from "react";
import {
  FlatList,
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
import { getAllowedApps, setAllowedApps } from "../blocking/FocusBlocker";
import { loadAllApps, PickableApp } from "../appList";

export default function AllowedScreen({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [apps, setApps] = useState<PickableApp[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const appIcons = useAppIcons(apps.map((a) => a.key));

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setSelected(new Set(getAllowedApps()));
    loadAllApps()
      .then(setApps)
      .catch(() => setApps([]));
  }, [visible]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const save = () => {
    setAllowedApps([...selected]);
    onClose();
  };

  const filtered = search.trim()
    ? apps.filter((a) => a.label.toLowerCase().includes(search.trim().toLowerCase()))
    : apps;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.back}>‹ Back</Text>
          </Pressable>
          <Text style={s.title}>Always Allowed</Text>
          <View style={{ width: 44 }} />
        </View>

        <Text style={s.hint}>
          These apps are never blocked — not by limits, rules, or focus sessions.
          Keep essentials like Phone, Maps and Messages here.
        </Text>

        <View style={s.searchBar}>
          <Ionicons name="search" size={16} color={C.ink3} />
          <TextInput
            style={s.searchInput}
            placeholder="Search apps"
            placeholderTextColor={C.ink3}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={C.ink3} />
            </Pressable>
          )}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(a) => a.key}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 96 }}
          ListEmptyComponent={
            <Text style={s.empty}>
              {search.trim() ? `No apps match "${search.trim()}".` : "Loading your apps…"}
            </Text>
          }
          renderItem={({ item }) => {
            const on = selected.has(item.key);
            return (
              <Pressable style={s.appRow} onPress={() => toggle(item.key)}>
                <AppIcon uri={appIcons[item.key]} label={item.label} size={34} />
                <Text style={s.appLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <View style={[s.check, on && s.checkOn]}>
                  {on && <Ionicons name="checkmark" size={15} color={C.onAccent} />}
                </View>
              </Pressable>
            );
          }}
        />

        <View style={s.footer}>
          <Pressable style={s.saveBtn} onPress={save}>
            <Text style={s.saveBtnText}>
              Save{selected.size > 0 ? ` · ${selected.size} allowed` : ""}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 52 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  back: { color: C.amber, fontSize: 16 },
  title: { color: C.ink, fontSize: 18, fontWeight: "700" },
  hint: { color: C.ink2, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: C.ink, fontSize: 15, padding: 0 },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appLabel: { color: C.ink, fontSize: 15, flex: 1 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.ink3,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: C.amber, borderColor: C.amber },
  empty: { color: C.ink3, textAlign: "center", paddingVertical: 40, fontSize: 14 },
  footer: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 24,
  },
  saveBtn: {
    backgroundColor: C.amber,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
    shadowColor: C.amber,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  saveBtnText: { color: C.onAccent, fontSize: 15.5, fontWeight: "700" },
});
