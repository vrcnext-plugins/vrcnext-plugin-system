/**
 * {@link OscApi} over VRCNext's OSC actions, or over the bridge where VRCNext has none.
 *
 * Verified actions: `oscConnect`, `oscDisconnect`, `oscSend { name, type, value }`,
 * `oscSendRaw { address, type, value }`. Verified events: `oscParams`, `oscAvatarParams`.
 *
 * VRCNext drops every `osc*` action on Linux, so there the same calls go to the bridge's `osc`
 * service, which holds the sockets itself. The two paths are the same sockets — VRChat listens
 * on 9000 and sends to 9001 either way — so a plugin does not choose between them and cannot
 * tell which one carried a message. VRCNext's own path is preferred wherever it works, because
 * one OSCQuery advertisement is better than two programs fighting over port 9001.
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
import type { BridgeClient } from './native.js';

/** The prefix VRChat puts on every avatar parameter. */
const PARAMETER_PREFIX = '/avatar/parameters/';

/** The address VRChat sends when the wearer changes avatar. */
const AVATAR_CHANGE = '/avatar/change';

/** The bridge's OSC service, as it names itself. */
const OSC_SERVICE = 'osc';

/** One argument as the bridge reports it. */
function firstArg(payload: unknown): { kind: string; value: unknown } | undefined {
  const record = asRecord(payload);
  const args = record?.['args'];
  if (!Array.isArray(args)) return undefined;
  const first = asRecord(args[0]);
  if (first === undefined) return undefined;
  return { kind: typeof first['kind'] === 'string' ? first['kind'] : '', value: first['value'] };
}

/** A bridge `osc` push as a parameter event, or `undefined` when it is not one. */
function bridgeParam(payload: unknown): OscParamEvent | undefined {
  const address = asRecord(payload)?.['address'];
  if (typeof address !== 'string' || !address.startsWith(PARAMETER_PREFIX)) return undefined;
  const arg = firstArg(payload);
  if (arg === undefined) return undefined;
  if (typeof arg.value !== 'boolean' && typeof arg.value !== 'number') return undefined;
  return { name: address.slice(PARAMETER_PREFIX.length), value: arg.value, kind: arg.kind };
}

/**
 * A bridge `osc` push as an avatar change.
 *
 * VRChat sends the id and nothing else, so the parameter list VRCNext's own event carries is
 * empty here rather than invented.
 */
function bridgeAvatarChange(payload: unknown): OscAvatarChangeEvent | undefined {
  const address = asRecord(payload)?.['address'];
  if (address !== AVATAR_CHANGE) return undefined;
  const arg = firstArg(payload);
  return { avatarId: typeof arg?.value === 'string' ? arg.value : '', parameters: [] };
}

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
  /** The bridge, which carries OSC where VRCNext will not. */
  readonly native: BridgeClient;
}

export class HostOscApi implements OscApi {
  readonly #bridge: Bridge;
  readonly #router: EventRouter;
  readonly #bag: DisposableBag;
  readonly #logger: Logger;
  readonly #native: BridgeClient;
  /** Whether VRCNext itself will carry OSC; false on Linux. */
  readonly #viaVrcnext: boolean;

  constructor(deps: OscApiDeps) {
    this.#bridge = deps.bridge;
    this.#router = deps.router;
    this.#bag = deps.bag;
    this.#logger = deps.logger;
    this.#native = deps.native;
    this.#viaVrcnext = deps.available;
  }

  /** Whether this bridge offers the `osc` service; false for one older than it. */
  get #viaBridge(): boolean {
    return !this.#viaVrcnext && this.#native.describe()?.services[OSC_SERVICE] !== undefined;
  }

  get available(): boolean {
    return this.#viaVrcnext || this.#viaBridge;
  }

  /** Logs rather than silently dropping, so an unsupported platform is visible in the log. */
  #guard(what: string): boolean {
    if (this.available) return true;
    this.#logger.warn(
      `OSC is Windows-only in VRCNext and this bridge offers no osc service; ${what} ignored.`,
    );
    return false;
  }

  /** A bridge call whose failure belongs in the log, not in the caller's lap: these are void. */
  #callBridge(method: string, params: Record<string, unknown>): void {
    this.#native.call(OSC_SERVICE, method, params).catch((error: unknown) => {
      this.#logger.warn(`OSC ${method} through the bridge failed: ${String(error)}`);
    });
  }

  connect(): void {
    if (!this.#guard('connect()')) return;
    // Sending needs no socket of ours, but a plugin that connects expects to start receiving.
    if (this.#viaBridge) this.#callBridge('listen', {});
    else this.#bridge.send('oscConnect');
  }

  disconnect(): void {
    if (!this.#guard('disconnect()')) return;
    if (this.#viaBridge) this.#callBridge('stop', {});
    else this.#bridge.send('oscDisconnect');
  }

  send(name: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    if (!this.#guard(`send(${name})`)) return;
    if (this.#viaBridge) this.#callBridge('send', { address: `${PARAMETER_PREFIX}${name}`, args: [{ kind, value }] });
    else this.#bridge.send('oscSend', { name, type: kind, value });
  }

  sendRaw(address: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    if (!this.#guard(`sendRaw(${address})`)) return;
    // The kind is passed on rather than inferred: JSON cannot tell 1 the int from 1.0 the
    // float, and VRChat drops a parameter of the wrong type without saying so.
    if (this.#viaBridge) this.#callBridge('send', { address, args: [{ kind, value }] });
    else this.#bridge.send('oscSendRaw', { address, type: kind, value });
  }

  onParam(listener: (event: OscParamEvent) => void): () => void {
    return this.#subscribe(
      () => this.#router.on('oscParams', (payload) => {
        const event = toParamEvent(payload);
        if (event !== undefined) listener(event);
      }),
      (payload) => {
        const event = bridgeParam(payload);
        if (event !== undefined) listener(event);
      },
    );
  }

  onAvatarChange(listener: (event: OscAvatarChangeEvent) => void): () => void {
    return this.#subscribe(
      () => this.#router.on('oscAvatarParams', (payload) => {
        const event = toAvatarChange(payload);
        if (event !== undefined) listener(event);
      }),
      (payload) => {
        const event = bridgeAvatarChange(payload);
        if (event !== undefined) listener(event);
      },
    );
  }

  /**
   * Listen on whichever path carries OSC here.
   *
   * Subscribing through the bridge also opens its receive socket: a plugin that only listens
   * never calls `connect`, and would otherwise wait forever on a port nobody bound.
   */
  #subscribe(viaVrcnext: () => () => void, onPush: (payload: unknown) => void): () => void {
    if (!this.#viaBridge) {
      const unsubscribe = viaVrcnext();
      this.#bag.add(unsubscribe);
      return unsubscribe;
    }
    this.#callBridge('listen', {});
    const unsubscribe = this.#native.onPush((event, data) => {
      if (event === OSC_SERVICE) onPush(data);
    });
    this.#bag.add(unsubscribe);
    return unsubscribe;
  }
}
