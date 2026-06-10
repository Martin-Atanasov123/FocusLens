import { describe, expect, it } from "vitest";
import { formatDuration, minuteBucket, splitAcrossMinutes } from "../src/time.js";

describe("minuteBucket", () => {
  it("floors to the minute in epoch seconds", () => {
    expect(minuteBucket(0)).toBe(0);
    expect(minuteBucket(59_999)).toBe(0);
    expect(minuteBucket(60_000)).toBe(60);
    expect(minuteBucket(1_700_000_123_456)).toBe(Math.floor(1_700_000_123.456 / 60) * 60);
  });
});

describe("splitAcrossMinutes", () => {
  it("returns empty for non-positive spans", () => {
    expect(splitAcrossMinutes(1000, 1000)).toEqual([]);
    expect(splitAcrossMinutes(2000, 1000)).toEqual([]);
  });

  it("attributes a span within one minute to that bucket", () => {
    // 00:00:10 → 00:00:25
    expect(splitAcrossMinutes(10_000, 25_000)).toEqual([{ bucketTs: 0, secs: 15 }]);
  });

  it("splits a span crossing a minute boundary", () => {
    // 00:00:50 → 00:01:20
    expect(splitAcrossMinutes(50_000, 80_000)).toEqual([
      { bucketTs: 0, secs: 10 },
      { bucketTs: 60, secs: 20 },
    ]);
  });

  it("covers full intermediate minutes", () => {
    // 00:00:30 → 00:02:30
    expect(splitAcrossMinutes(30_000, 150_000)).toEqual([
      { bucketTs: 0, secs: 30 },
      { bucketTs: 60, secs: 60 },
      { bucketTs: 120, secs: 30 },
    ]);
  });

  it("total seconds equals the span length", () => {
    const start = 1_700_000_111_000;
    const end = start + 7 * 60_000 + 13_000;
    const total = splitAcrossMinutes(start, end).reduce((a, b) => a + b.secs, 0);
    expect(total).toBe(7 * 60 + 13);
  });

  it("drops sub-second slivers instead of emitting zero-second buckets", () => {
    const spans = splitAcrossMinutes(59_900, 60_100);
    const total = spans.reduce((a, b) => a + b.secs, 0);
    expect(spans.every((s) => s.secs > 0)).toBe(true);
    expect(total).toBeLessThanOrEqual(1);
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes, seconds", () => {
    expect(formatDuration(8045)).toBe("2h 14m");
    expect(formatDuration(840)).toBe("14m");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(0)).toBe("0s");
  });
});
