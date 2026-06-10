/** Wire types shared between the browser extension and the desktop agent. */

/** One minute-bucket of active time attributed to a domain by the extension. */
export interface ExtensionUsageEvent {
  /** Unix epoch seconds, floored to the minute. */
  bucketTs: number;
  /** Hostname only (e.g. "youtube.com") — never a full URL. */
  domain: string;
  /** Seconds of active foreground time within this bucket (1..60). */
  activeSecs: number;
}

/** Body of POST http://127.0.0.1:48732/events */
export interface PostEventsRequest {
  events: ExtensionUsageEvent[];
}

export interface PostEventsResponse {
  accepted: number;
}

/** One row of a daily summary, as returned by GET /summary/today and the dashboard. */
export interface EntrySummary {
  key: string;
  label: string;
  activeSecs: number;
  source: "desktop" | "extension";
}

export interface DaySummary {
  /** Local date, YYYY-MM-DD. */
  date: string;
  totalActiveSecs: number;
  apps: EntrySummary[];
  domains: EntrySummary[];
}

export const AGENT_PORT = 48732;
export const AGENT_BASE_URL = `http://127.0.0.1:${AGENT_PORT}`;
export const TOKEN_HEADER = "x-focuslens-token";
