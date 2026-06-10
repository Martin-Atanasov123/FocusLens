/** Minute-bucket helpers. All bucket timestamps are unix epoch seconds floored to 60. */

export const MINUTE = 60;

/** Floor a millisecond timestamp to its minute bucket (epoch seconds). */
export function minuteBucket(tsMs: number): number {
  return Math.floor(tsMs / 1000 / MINUTE) * MINUTE;
}

export interface BucketSpan {
  bucketTs: number;
  secs: number;
}

/**
 * Split the span [startMs, endMs) across minute buckets with second resolution.
 * Sub-second remainders are accumulated so total attributed seconds equals
 * round((endMs - startMs) / 1000). Returns [] for empty/negative spans.
 */
export function splitAcrossMinutes(startMs: number, endMs: number): BucketSpan[] {
  if (endMs <= startMs) return [];
  const out: BucketSpan[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const bucketTs = minuteBucket(cursor);
    const bucketEndMs = (bucketTs + MINUTE) * 1000;
    const sliceEnd = Math.min(endMs, bucketEndMs);
    const secs = Math.round((sliceEnd - cursor) / 1000);
    if (secs > 0) out.push({ bucketTs, secs });
    cursor = sliceEnd;
  }
  return out;
}

/** Format seconds as "2h 14m" / "14m" / "45s". */
export function formatDuration(totalSecs: number): string {
  const s = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s % 60}s`;
}
