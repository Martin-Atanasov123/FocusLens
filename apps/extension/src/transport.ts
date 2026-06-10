// Delivery to the desktop agent with an offline buffer. Storage and fetch are
// injected so the logic is unit-testable without chrome.* or a network.

import {
  AGENT_BASE_URL,
  TOKEN_HEADER,
  type ExtensionUsageEvent,
  type PostEventsRequest,
} from "@focuslens/shared";

export interface QueueStorage {
  get(): Promise<ExtensionUsageEvent[]>;
  set(events: ExtensionUsageEvent[]): Promise<void>;
}

export interface SendResult {
  ok: boolean;
  sent: number;
  queued: number;
}

/** Keep at most this many buffered events (~3.5 days of continuous browsing). */
export const MAX_QUEUE = 5000;

export class Transport {
  constructor(
    private readonly storage: QueueStorage,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly maxQueue: number = MAX_QUEUE,
  ) {}

  /** Buffer events; oldest are dropped beyond the cap. */
  async enqueue(events: ExtensionUsageEvent[]): Promise<void> {
    if (events.length === 0) return;
    let queue = [...(await this.storage.get()), ...events];
    if (queue.length > this.maxQueue) queue = queue.slice(queue.length - this.maxQueue);
    await this.storage.set(queue);
  }

  /**
   * Try to deliver the whole buffer to the agent. On any failure (agent not
   * running, bad token, network error) the buffer is kept for the next try.
   */
  async deliver(token: string): Promise<SendResult> {
    const queue = await this.storage.get();
    if (queue.length === 0) return { ok: true, sent: 0, queued: 0 };

    const body: PostEventsRequest = { events: queue };
    let ok = false;
    try {
      const resp = await this.fetchFn(`${AGENT_BASE_URL}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
        body: JSON.stringify(body),
      });
      ok = resp.ok;
    } catch {
      ok = false;
    }

    if (ok) {
      await this.storage.set([]);
      return { ok: true, sent: queue.length, queued: 0 };
    }
    return { ok: false, sent: 0, queued: queue.length };
  }
}

/** chrome.storage.local-backed queue used by the real service worker. */
export function chromeQueueStorage(key = "eventQueue"): QueueStorage {
  return {
    async get() {
      const data = await chrome.storage.local.get(key);
      return (data[key] as ExtensionUsageEvent[] | undefined) ?? [];
    },
    async set(events) {
      await chrome.storage.local.set({ [key]: events });
    },
  };
}
