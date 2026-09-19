/**
 * {@link OscApi} over VRCNext's OSC actions.
 *
 * Verified actions: `oscConnect`, `oscDisconnect`, `oscSend { name, type, value }`,
 * `oscSendRaw { address, type, value }`. Verified events: `oscParams`, `oscAvatarParams`.
 */

import type {
  Bridge,
  DisposableBag,
  Logger,
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

export interface OscApiDeps {
  readonly bridge: Bridge;
  readonly router: EventRouter;
  readonly bag: DisposableBag;
  readonly logger: Logger;
  /** VRCNext drops every `osc*` action on Linux, so sending there is pointless. */
  readonly available: boolean;
}

export class HostOscApi implements OscApi {
  readonly #bridge: Bridge;
  readonly #router: EventRouter;
  readonly #bag: DisposableBag;
  readonly #logger: Logger;
  readonly available: boolean;

  constructor(deps: OscApiDeps) {
    this.#bridge = deps.bridge;
    this.#router = deps.router;
    this.#bag = deps.bag;
    this.#logger = deps.logger;
    this.available = deps.available;
  }

  /** Logs rather than silently dropping, so an unsupported platform is visible in the log. */
  #guard(what: string): boolean {
    if (this.available) return true;
    this.#logger.warn(`OSC is Windows-only in VRCNext; ${what} ignored.`);
    return false;
  }

  connect(): void {
    if (!this.#guard('connect()')) return;
    this.#bridge.send('oscConnect');
  }

  disconnect(): void {
    if (!this.#guard('disconnect()')) return;
    this.#bridge.send('oscDisconnect');
  }

  send(name: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    if (!this.#guard(`send(${name})`)) return;
    this.#bridge.send('oscSend', { name, type: kind, value });
  }

  sendRaw(address: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    if (!this.#guard(`sendRaw(${address})`)) return;
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
