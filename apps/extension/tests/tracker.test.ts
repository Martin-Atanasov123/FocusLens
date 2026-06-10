import { describe, expect, it } from "vitest";
import { TabTracker } from "../src/tracker";

// Minute-aligned base so bucket expectations are easy to read.
const T0 = 1_700_000_040_000 - (1_700_000_040_000 % 60_000);
const tsOf = (bucketMs: number) => Math.floor(bucketMs / 1000);

describe("TabTracker", () => {
  it("attributes time to the active domain", () => {
    const t = new TabTracker();
    t.setDomain("youtube.com", T0);
    const events = t.flush(T0 + 30_000);
    expect(events).toEqual([{ bucketTs: tsOf(T0), domain: "youtube.com", activeSecs: 30 }]);
  });

  it("splits attribution on tab switch", () => {
    const t = new TabTracker();
    t.setDomain("youtube.com", T0);
    t.setDomain("github.com", T0 + 20_000);
    const events = t.flush(T0 + 50_000);
    expect(events).toEqual([
      { bucketTs: tsOf(T0), domain: "github.com", activeSecs: 30 },
      { bucketTs: tsOf(T0), domain: "youtube.com", activeSecs: 20 },
    ]);
  });

  it("splits across minute buckets", () => {
    const t = new TabTracker();
    t.setDomain("github.com", T0 + 50_000);
    const events = t.flush(T0 + 80_000); // 10s in minute 0, 20s in minute 1
    expect(events).toEqual([
      { bucketTs: tsOf(T0), domain: "github.com", activeSecs: 10 },
      { bucketTs: tsOf(T0) + 60, domain: "github.com", activeSecs: 20 },
    ]);
  });

  it("stops attributing while the window is unfocused", () => {
    const t = new TabTracker();
    t.setDomain("youtube.com", T0);
    t.setFocused(false, T0 + 10_000);
    t.setFocused(true, T0 + 40_000);
    const events = t.flush(T0 + 50_000);
    expect(events).toEqual([{ bucketTs: tsOf(T0), domain: "youtube.com", activeSecs: 20 }]);
  });

  it("stops attributing while idle", () => {
    const t = new TabTracker();
    t.setDomain("youtube.com", T0);
    t.setIdle(true, T0 + 15_000);
    t.setIdle(false, T0 + 45_000);
    const events = t.flush(T0 + 55_000);
    expect(events).toEqual([{ bucketTs: tsOf(T0), domain: "youtube.com", activeSecs: 25 }]);
  });

  it("does not attribute untrackable pages", () => {
    const t = new TabTracker();
    t.setDomain(null, T0); // e.g. chrome://extensions
    t.setDomain("github.com", T0 + 30_000);
    const events = t.flush(T0 + 40_000);
    expect(events).toEqual([{ bucketTs: tsOf(T0), domain: "github.com", activeSecs: 10 }]);
  });

  it("flush drains state — second flush is empty", () => {
    const t = new TabTracker();
    t.setDomain("github.com", T0);
    expect(t.flush(T0 + 10_000)).toHaveLength(1);
    expect(t.flush(T0 + 10_000)).toHaveLength(0);
    // …but tracking continues after the flush.
    expect(t.flush(T0 + 20_000)).toEqual([
      { bucketTs: tsOf(T0), domain: "github.com", activeSecs: 10 },
    ]);
  });

  it("caps any bucket at 60 seconds", () => {
    const t = new TabTracker();
    t.setDomain("github.com", T0);
    const events = t.flush(T0 + 180_000);
    expect(events.every((e) => e.activeSecs <= 60)).toBe(true);
    const total = events.reduce((a, e) => a + e.activeSecs, 0);
    expect(total).toBe(180);
  });

  it("revisiting a domain within the same bucket accumulates", () => {
    const t = new TabTracker();
    t.setDomain("github.com", T0);
    t.setDomain("youtube.com", T0 + 10_000);
    t.setDomain("github.com", T0 + 20_000);
    const events = t.flush(T0 + 30_000);
    expect(events).toEqual([
      { bucketTs: tsOf(T0), domain: "github.com", activeSecs: 20 },
      { bucketTs: tsOf(T0), domain: "youtube.com", activeSecs: 10 },
    ]);
  });

  it("total attributed time never exceeds wall clock", () => {
    const t = new TabTracker();
    let now = T0;
    const domains = ["a.com", "b.com", null, "c.com"];
    for (let i = 0; i < 40; i++) {
      t.setDomain(domains[i % domains.length] ?? null, now);
      if (i % 7 === 0) t.setIdle(i % 14 === 0, now);
      now += 13_000;
    }
    const events = t.flush(now);
    const total = events.reduce((a, e) => a + e.activeSecs, 0);
    expect(total).toBeLessThanOrEqual((now - T0) / 1000);
  });
});
