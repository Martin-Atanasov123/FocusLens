import { invoke } from "@tauri-apps/api/core";
import type { DaySummary } from "@focuslens/shared";

export type { DaySummary, EntrySummary } from "@focuslens/shared";

export interface LimitWithUsage {
  id: number;
  targetKind: "app" | "domain";
  targetKey: string;
  period: "daily" | "weekly";
  limitSecs: number;
  limitType: "soft" | "hard";
  enabled: boolean;
  usedSecsToday: number;
}

export interface LimitInput {
  id?: number;
  targetKind: string;
  targetKey: string;
  period: string;
  limitSecs: number;
  limitType: string;
  enabled: boolean;
}

export const getDaySummary = (date?: string) =>
  invoke<DaySummary>("get_day_summary", { date });

export const getLimits = () => invoke<LimitWithUsage[]>("get_limits");

export const upsertLimit = (limit: LimitInput) =>
  invoke<number>("upsert_limit", { limit });

export const deleteLimit = (id: number) => invoke<void>("delete_limit", { id });

export const getPairingToken = () => invoke<string>("get_pairing_token");

export const getTrackingPaused = () => invoke<boolean>("get_tracking_paused");

export const setTrackingPaused = (paused: boolean) =>
  invoke<void>("set_tracking_paused", { paused });
