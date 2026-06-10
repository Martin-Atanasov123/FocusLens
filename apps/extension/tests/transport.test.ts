import { describe, expect, it, vi } from "vitest";
import type { ExtensionUsageEvent } from "@focuslens/shared";
import { Transport, type QueueStorage } from "../src/transport";

function memoryStorage(initial: ExtensionUsageEvent[] = []): QueueStorage & { data: ExtensionUsageEvent[] } {
  const box = {
    data: initial,
    async get() {
      return box.data;
    },
    async set(events: ExtensionUsageEvent[]) {
      box.data = events;
    },
  };
  return box;
}

const ev = (bucketTs: number, domain = "github.com"): ExtensionUsageEvent => ({
  bucketTs,
  domain,
  activeSecs: 60,
});

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, status: 200 });
const downFetch = () => vi.fn().mockRejectedValue(new TypeError("fetch failed"));

describe("Transport", () => {
  it("delivers the queue and clears it on success", async () => {
    const storage = memoryStorage([ev(60), ev(120)]);
    const fetchFn = okFetch();
    const result = await new Transport(storage, fetchFn).deliver("tok");
    expect(result).toEqual({ ok: true, sent: 2, queued: 0 });
    expect(storage.data).toEqual([]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:48732/events");
    expect(init.headers["x-focuslens-token"]).toBe("tok");
    expect(JSON.parse(init.body).events).toHaveLength(2);
  });

  it("keeps the queue when the agent is unreachable", async () => {
    const storage = memoryStorage([ev(60)]);
    const result = await new Transport(storage, downFetch()).deliver("tok");
    expect(result).toEqual({ ok: false, sent: 0, queued: 1 });
    expect(storage.data).toHaveLength(1);
  });

  it("keeps the queue on a rejected token (401)", async () => {
    const storage = memoryStorage([ev(60)]);
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await new Transport(storage, fetchFn).deliver("bad");
    expect(result.ok).toBe(false);
    expect(storage.data).toHaveLength(1);
  });

  it("does not call fetch for an empty queue", async () => {
    const fetchFn = okFetch();
    const result = await new Transport(memoryStorage(), fetchFn).deliver("tok");
    expect(result).toEqual({ ok: true, sent: 0, queued: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("enqueue appends and drops oldest beyond the cap", async () => {
    const storage = memoryStorage();
    const transport = new Transport(storage, okFetch(), 3);
    await transport.enqueue([ev(60), ev(120)]);
    await transport.enqueue([ev(180), ev(240)]);
    expect(storage.data.map((e) => e.bucketTs)).toEqual([120, 180, 240]);
  });

  it("enqueue with no events leaves storage untouched", async () => {
    const storage = memoryStorage([ev(60)]);
    await new Transport(storage, okFetch()).enqueue([]);
    expect(storage.data).toHaveLength(1);
  });
});
