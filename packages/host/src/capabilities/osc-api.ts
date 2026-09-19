/**
 * {@link OscApi} over VRCNext's OSC actions.
 *
 * Verified actions: `oscConnect`, `oscDisconnect`, `oscSend { name, type, value }`,
 * `oscSendRaw { address, type, value }`. Verified events: `oscParams`, `oscAvatarParams`.
 */

import type {
  Bridge,
  DisposableBag,
  OscApi,
  OscAvatarChangeEvent,
  OscParamEvent,
} from '@vrcnext/plugin-api';

import type { EventRouter } from '../events/event-router.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function toParamEvent(payload: unknown): OscParamEvent | undefined {
  const record = asRecord(payload);
  if (record === undefined) return undefined;
  const name = record['name'];
  const value = record['value'];
  if (typeof name !== 'string') return undefined;
  if (typeof value !== 'boolean' && typeof value !== 'number') return undefined;
  const kind = record['type'];
  return { name, value, kind: typeof kind === 'string' ? kind : typeof value };
}

function toAvatarChange(payload: unknown): OscAvatarChangeEvent | undefined {
  const record = asRecord(payload);
  if (record === undefined) return undefined;
  const rawParams = record['parameters'] ?? record['params'];
  const parameters = Array.isArray(rawParams)
    ? rawParams.flatMap((entry) => {
        const p = asRecord(entry);
        if (p === undefined) return [];
        const name = p['name'];
        if (typeof name !== 'string') return [];
        return [
          {
            name,
            type: typeof p['type'] === 'string' ? p['type'] : '',
            hasInput: p['hasInput'] === true,
            hasOutput: p['hasOutput'] === true,
          },
        ];
      })
    : [];
  const avatarId = record['avatarId'] ?? record['id'];
  return { avatarId: typeof avatarId === 'string' ? avatarId : '', parameters };
}

export class HostOscApi implements OscApi {
  readonly #bridge: Bridge;
  readonly #router: EventRouter;
  readonly #bag: DisposableBag;

  constructor(bridge: Bridge, router: EventRouter, bag: DisposableBag) {
    this.#bridge = bridge;
    this.#router = router;
    this.#bag = bag;
  }

  connect(): void {
    this.#bridge.send('oscConnect');
  }

  disconnect(): void {
    this.#bridge.send('oscDisconnect');
  }

  send(name: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    this.#bridge.send('oscSend', { name, type: kind, value });
  }

  sendRaw(address: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    this.#bridge.send('oscSendRaw', { address, type: kind, value });
  }

  onParam(listener: (event: OscParamEvent) => void): () => void {
    const unsubscribe = this.#router.on('oscParams', (payload) => {
      const event = toParamEvent(payload);
      if (event !== undefined) listener(event);
    });
    this.#bag.add(unsubscribe);
    return unsubscribe;
  }

  onAvatarChange(listener: (event: OscAvatarChangeEvent) => void): () => void {
    const unsubscribe = this.#router.on('oscAvatarParams', (payload) => {
      const event = toAvatarChange(payload);
      if (event !== undefined) listener(event);
    });
    this.#bag.add(unsubscribe);
    return unsubscribe;
  }
}
