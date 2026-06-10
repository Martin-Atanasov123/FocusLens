// Pure tab-session tracker: event timestamps in, minute buckets out.
// No chrome.* access here — background.ts owns the wiring, this owns the logic.

import { splitAcrossMinutes, type ExtensionUsageEvent } from "@focuslens/shared";

/**
 * Attributes wall-clock time to the active tab's domain. Time is only
 * attributed while a domain is set, the browser window is focused, and the
 * user is not idle. Event-driven: each state change closes the current
 * attribution span, so no per-second polling is needed.
 */
export class TabTracker {
  private domain: string | null = null;
  private focused = true;
  private idle = false;
  private spanStartMs: number | null = null;
  /** bucketTs -> domain -> seconds */
  private pending = new Map<number, Map<string, number>>();

  private isTracking(): boolean {
    return this.domain !== null && this.focused && !this.idle;
  }

  /** Close the running span, attributing its time if we were tracking. */
  private closeSpan(nowMs: number): void {
    if (this.isTracking() && this.spanStartMs !== null && this.domain !== null) {
      for (const { bucketTs, secs } of splitAcrossMinutes(this.spanStartMs, nowMs)) {
        const byDomain = this.pending.get(bucketTs) ?? new Map<string, number>();
        byDomain.set(this.domain, (byDomain.get(this.domain) ?? 0) + secs);
        this.pending.set(bucketTs, byDomain);
      }
    }
    this.spanStartMs = nowMs;
  }

  /** Active tab changed or navigated. Null = untrackable page (chrome://, …). */
  setDomain(domain: string | null, nowMs: number): void {
    this.closeSpan(nowMs);
    this.domain = domain;
  }

  /** Browser window gained/lost focus. */
  setFocused(focused: boolean, nowMs: number): void {
    this.closeSpan(nowMs);
    this.focused = focused;
  }

  /** User went idle / came back (chrome.idle). */
  setIdle(idle: boolean, nowMs: number): void {
    this.closeSpan(nowMs);
    this.idle = idle;
  }

  /** Close the current span and drain all accumulated buckets. */
  flush(nowMs: number): ExtensionUsageEvent[] {
    this.closeSpan(nowMs);
    const events: ExtensionUsageEvent[] = [];
    for (const [bucketTs, byDomain] of this.pending) {
      for (const [domain, secs] of byDomain) {
        const activeSecs = Math.min(60, Math.round(secs));
        if (activeSecs > 0) events.push({ bucketTs, domain, activeSecs });
      }
    }
    this.pending.clear();
    events.sort((a, b) => a.bucketTs - b.bucketTs || a.domain.localeCompare(b.domain));
    return events;
  }
}
