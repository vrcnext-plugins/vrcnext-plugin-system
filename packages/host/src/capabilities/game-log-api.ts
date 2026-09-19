/**
 * {@link GameLogApi} over VRCNext's `gameLogEvent` / `gameLogHistory`.
 */

import type { Bridge, DisposableBag, GameLogApi, GameLogEntry } from '@vrcnext/plugin-api';

import type { EventRouter } from '../events/event-router.js';

function toEntry(payload: unknown): GameLogEntry | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string') return undefined;
  return {
    type,
    timestamp: typeof record['timestamp'] === 'string' ? record['timestamp'] : '',
    message: typeof record['message'] === 'string' ? record['message'] : '',
    detail: typeof record['detail'] === 'string' ? record['detail'] : '',
  };
}

export class HostGameLogApi implements GameLogApi {
  readonly #bridge: Bridge;
  readonly #router: EventRouter;
  readonly #bag: DisposableBag;

  constructor(bridge: Bridge, router: EventRouter, bag: DisposableBag) {
    this.#bridge = bridge;
    this.#router = router;
    this.#bag = bag;
  }

  on(listener: (entry: GameLogEntry) => void): () => void {
    const unsubscribe = this.#router.on('gameLogEvent', (payload) => {
      const entry = toEntry(payload);
      if (entry !== undefined) listener(entry);
    });
    this.#bag.add(unsubscribe);
    return unsubscribe;
  }

  onType(type: string, listener: (entry: GameLogEntry) => void): () => void {
    return this.on((entry) => {
      if (entry.type === type) listener(entry);
    });
  }

  async history(signal?: AbortSignal): Promise<readonly GameLogEntry[]> {
    const payload = await this.#bridge.request(
      'getGameLog',
      {},
      { expect: 'gameLogHistory', ...(signal !== undefined ? { signal } : {}) },
    );
    if (typeof payload !== 'object' || payload === null) return [];
    const entries = (payload as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((raw) => {
      const entry = toEntry(raw);
      return entry === undefined ? [] : [entry];
    });
  }
}
