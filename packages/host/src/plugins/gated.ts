/**
 * The capability wrappers a plugin actually holds.
 *
 * Each one checks the category ceiling on every call and asks the broker about the concrete
 * target on first use. Async methods await the answer; sync methods (subscriptions, fire-and-
 * forget sends) run their effect once the answer arrives and return at once, so a plugin's
 * `activate` does not block on a modal.
 */

import {
  type ActionArgs,
  type ActionName,
  type Bridge,
  type ClipboardApi,
  type DeepLinkApi,
  type DeepLinkEvent,
  type DeepLinkPrefix,
  type DisposableBag,
  type EventBus,
  type EventListener,
  type EventPayload,
  type GameLogApi,
  type GameLogEntry,
  type HostEnvelope,
  type HttpApi,
  type NativeApi,
  type NativeNotifyOptions,
  type NativeNotifyResult,
  type NativeTarget,
  type OscApi,
  type OscAvatarChangeEvent,
  type OscParamEvent,
  type Permission,
  PermissionError,
  type RequestOptions,
  type VrchatApi,
} from '@vrcnext/plugin-api';

import type { BridgeClient } from '../capabilities/native.js';
import type { EventRouter } from '../events/event-router.js';
import type { PluginGate } from '../permissions/plugin-gate.js';
import {
  actionPrompt,
  bridgePrompt,
  clipboardPrompt,
  eventPrompt,
  gamelogPrompt,
  interceptPrompt,
  networkPrompt,
  oscPrompt,
  vrchatPrompt,
} from '../permissions/prompts.js';
import { ANY_TARGET, type PromptRequest } from '../permissions/types.js';

/**
 * Subscribe once allowed. The returned unsubscribe works whether the answer is in or not: an
 * unsubscribe before the allow simply cancels the pending subscription.
 */
function lazySubscribe(
  gate: PluginGate,
  request: PromptRequest,
  bag: DisposableBag,
  subscribe: () => () => void,
): () => void {
  let unsubscribe: (() => void) | undefined;
  let cancelled = false;
  gate.whenAllowed(request, () => {
    if (cancelled) return;
    unsubscribe = subscribe();
    bag.add(unsubscribe);
  });
  return (): void => {
    cancelled = true;
    unsubscribe?.();
  };
}

/**
 * Wrap an object so every method call first checks the category ceiling. Non-function members
 * (`available`, `base`, `desktopAvailable`) stay readable, so a plugin can branch on them.
 */
export function categoryGuarded<T extends object>(gate: PluginGate, permission: Permission, inner: T): T {
  return new Proxy(inner, {
    get(target, property, receiver): unknown {
      const member: unknown = Reflect.get(target, property, receiver);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]): unknown => {
        gate.requireCategory(permission);
        return Reflect.apply(member, target, args);
      };
    },
  });
}

export class GatedEventBus implements EventBus {
  readonly #router: EventRouter;
  readonly #bag: DisposableBag;
  readonly #gate: PluginGate;

  constructor(router: EventRouter, bag: DisposableBag, gate: PluginGate) {
    this.#router = router;
    this.#bag = bag;
    this.#gate = gate;
  }

  on<T extends string>(type: T, listener: EventListener<T>): () => void {
    this.#gate.requireDeclared('host:events', type);
    return lazySubscribe(this.#gate, eventPrompt(this.#gate.subject, type), this.#bag, () =>
      this.#router.on(type, (payload) => { listener(payload as EventPayload<T>); }),
    );
  }

  once<T extends string>(type: T, listener: EventListener<T>): () => void {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  onAny(listener: (envelope: HostEnvelope) => void): () => void {
    this.#gate.requireDeclared('host:events', ANY_TARGET);
    return lazySubscribe(this.#gate, eventPrompt(this.#gate.subject, ANY_TARGET), this.#bag, () =>
      this.#router.onAny(listener),
    );
  }

  async next<T extends string>(type: T, signal?: AbortSignal): Promise<EventPayload<T>> {
    this.#gate.requireDeclared('host:events', type);
    await this.#gate.check(eventPrompt(this.#gate.subject, type));
    return this.#router.next(type, signal);
  }
}

export class GatedBridge implements Bridge {
  readonly #inner: Bridge;
  readonly #gate: PluginGate;
  readonly #bag: DisposableBag;

  constructor(inner: Bridge, gate: PluginGate, bag: DisposableBag) {
    this.#inner = inner;
    this.#gate = gate;
    this.#bag = bag;
  }

  send(action: ActionName, args: ActionArgs = {}): void {
    this.#gate.requireDeclared('host:actions', action);
    this.#gate.whenAllowed(actionPrompt(this.#gate.subject, action, args), () => {
      this.#inner.send(action, args);
    });
  }

  async request<T extends string>(
    action: ActionName,
    args: ActionArgs,
    options: RequestOptions & { readonly expect: T },
  ): Promise<EventPayload<T>> {
    this.#gate.requireDeclared('host:actions', action);
    await this.#gate.check(actionPrompt(this.#gate.subject, action, args));
    return this.#inner.request(action, args, options);
  }

  interceptOutbound(interceptor: (action: ActionName, raw: string) => boolean | undefined): () => void {
    return lazySubscribe(this.#gate, interceptPrompt(this.#gate.subject), this.#bag, () =>
      this.#inner.interceptOutbound(interceptor),
    );
  }
}

/** Deep links are the `openDeepLink` event under another name, and are gated as that event. */
export class GatedDeepLinks implements DeepLinkApi {
  readonly #inner: DeepLinkApi;
  readonly #gate: PluginGate;
  readonly #bag: DisposableBag;

  constructor(inner: DeepLinkApi, gate: PluginGate, bag: DisposableBag) {
    this.#inner = inner;
    this.#gate = gate;
    this.#bag = bag;
  }

  on(listener: (event: DeepLinkEvent) => boolean | undefined): () => void {
    return lazySubscribe(
      this.#gate,
      eventPrompt(this.#gate.subject, 'openDeepLink'),
      this.#bag,
      () => this.#inner.on(listener),
    );
  }

  onPrefix(prefix: DeepLinkPrefix, listener: (event: DeepLinkEvent) => boolean | undefined): () => void {
    return this.on((event) => (event.prefix === prefix ? listener(event) : undefined));
  }
}

/** The bridge's `outbound.fetch` answer, before it is turned back into a `Response`. */
interface OutboundReply {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function toOutboundReply(value: unknown): OutboundReply | undefined {
  if (!isRecord(value)) return undefined;
  const { status, statusText, url, headers, body } = value;
  if (typeof status !== 'number' || typeof body !== 'string') return undefined;
  const pairs = isRecord(headers)
    ? Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    : [];
  return {
    status,
    statusText: typeof statusText === 'string' ? statusText : '',
    url: typeof url === 'string' ? url : '',
    headers: Object.fromEntries(pairs),
    body,
  };
}

/** What `init` carries that the bridge can be told about. Anything else has no wire form. */
function outboundParams(url: URL, init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    throw new PermissionError('network', 'only a string body can be sent through the bridge', url.host);
  }
  const headers = new Headers(init?.headers);
  return {
    url: url.href,
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: Object.fromEntries(headers.entries()),
    ...(typeof body === 'string' ? { body } : {}),
  };
}

/**
 * The only `fetch` a plugin has.
 *
 * Requests go through the bridge's `outbound` service whenever it is connected, and fall back to
 * the page's own `fetch` when it is not. The difference is not a detail: the page may only read
 * a cross-origin response the server has agreed to share, so an API that sends no CORS headers —
 * the Steam Web API, most plain JSON endpoints — is simply unreachable from here. The bridge is
 * not a browser and reaches them.
 *
 * Because it reaches further, nothing is assumed: every distinct host is asked about before the
 * first request to it, whether or not `plugin.json` declared it. A declared host is the plugin
 * saying where it means to go; the answer is the user's.
 */
export class GatedHttp implements HttpApi {
  readonly #gate: PluginGate;
  readonly #signal: AbortSignal;
  readonly #bridge: BridgeClient | undefined;

  constructor(gate: PluginGate, signal: AbortSignal, bridge?: BridgeClient) {
    this.#gate = gate;
    this.#signal = signal;
    this.#bridge = bridge;
  }

  async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    let parsed: URL;
    try {
      parsed = url instanceof URL ? url : new URL(url);
    } catch {
      throw new PermissionError('network', `"${String(url)}" is not an absolute URL`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new PermissionError('network', `${parsed.protocol} is not http(s)`, parsed.host);
    }
    await this.#gate.check(networkPrompt(this.#gate.subject, parsed, init));
    const bridge = this.#bridge;
    if (bridge?.status === 'connected') {
      return this.#viaBridge(bridge, parsed, init);
    }
    // The plugin's lifetime signal is always attached; a caller's own signal is honoured too.
    const signal =
      init?.signal instanceof AbortSignal ? AbortSignal.any([this.#signal, init.signal]) : this.#signal;
    return globalThis.fetch(parsed, { ...init, signal });
  }

  async #viaBridge(bridge: BridgeClient, url: URL, init: RequestInit | undefined): Promise<Response> {
    const reply = toOutboundReply(await bridge.call('outbound', 'fetch', outboundParams(url, init)));
    if (reply === undefined) throw new TypeError('The bridge answered the request with something else.');
    // 204 and 304 may carry no body at all, and the Response constructor refuses one for them.
    const body = reply.status === 204 || reply.status === 304 ? null : reply.body;
    const response = new Response(body, {
      status: reply.status,
      statusText: reply.statusText,
      headers: reply.headers,
    });
    // `url` is read-only on Response and the bridge may have followed redirects, so the final
    // URL is restored here rather than silently reading as ''.
    Object.defineProperty(response, 'url', { value: reply.url === '' ? url.href : reply.url });
    return response;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class GatedNative implements NativeApi {
  readonly #client: BridgeClient;
  readonly #gate: PluginGate;

  constructor(client: BridgeClient, gate: PluginGate) {
    this.#client = client;
    this.#gate = gate;
  }

  async targets(): Promise<readonly NativeTarget[]> {
    const body = await this.call('notify', 'targets', {});
    const targets = isRecord(body) ? body['targets'] : undefined;
    return Array.isArray(targets) ? (targets as NativeTarget[]) : [];
  }

  /** Bridge and transport failures become `ok: false`; a permission refusal still rejects. */
  async notify(options: NativeNotifyOptions): Promise<NativeNotifyResult> {
    try {
      return (await this.call('notify', 'send', options)) as NativeNotifyResult;
    } catch (error) {
      if (error instanceof PermissionError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, delivered: [], failed: [{ sink: 'bridge', error: message }] };
    }
  }

  async call(service: string, method: string, params: unknown = {}): Promise<unknown> {
    await this.#gate.check(bridgePrompt(this.#gate.subject, service, method, params));
    return this.#client.call(service, method, params);
  }
}

/**
 * Asked once per plugin. Every method awaits that one answer; `self()` is synchronous, so it
 * starts the prompt and answers `undefined` until the grant is in.
 */
export function gatedVrchat(inner: VrchatApi, gate: PluginGate): VrchatApi {
  const request = vrchatPrompt(gate.subject);
  let asked = false;
  return new Proxy(inner, {
    get(target, property, receiver): unknown {
      const member: unknown = Reflect.get(target, property, receiver);
      if (typeof member !== 'function') return member;
      if (property === 'self') {
        return (): unknown => {
          gate.requireCategory('vrchat');
          if (gate.isAllowed(request)) return Reflect.apply(member, target, []);
          // Synchronous, so it cannot await the prompt — start it and answer `undefined` until
          // the answer is in. Without this a plugin whose first VRChat call is `self()` would
          // never be asked at all: it would read `undefined`, conclude nobody is signed in, and
          // return before reaching the awaited call that would have prompted.
          if (!asked) {
            asked = true;
            gate.whenAllowed(request, () => undefined);
          }
          return undefined;
        };
      }
      return async (...args: unknown[]): Promise<unknown> => {
        await gate.check(request);
        return Reflect.apply(member, target, args) as unknown;
      };
    },
  });
}

export class GatedClipboard implements ClipboardApi {
  readonly #gate: PluginGate;

  constructor(gate: PluginGate) {
    this.#gate = gate;
  }

  async writeText(text: string): Promise<void> {
    await this.#gate.check(clipboardPrompt(this.#gate.subject, 'write'));
    await globalThis.navigator.clipboard.writeText(text);
  }

  async readText(): Promise<string> {
    await this.#gate.check(clipboardPrompt(this.#gate.subject, 'read'));
    return globalThis.navigator.clipboard.readText();
  }
}

/** Asked once per plugin; every method waits for that one answer. */
export class GatedOsc implements OscApi {
  readonly #inner: OscApi;
  readonly #gate: PluginGate;
  readonly #bag: DisposableBag;

  constructor(inner: OscApi, gate: PluginGate, bag: DisposableBag) {
    this.#inner = inner;
    this.#gate = gate;
    this.#bag = bag;
  }

  get available(): boolean {
    return this.#inner.available;
  }

  #when(effect: () => void): void {
    this.#gate.whenAllowed(oscPrompt(this.#gate.subject), effect);
  }

  connect(): void {
    this.#when(() => { this.#inner.connect(); });
  }

  disconnect(): void {
    this.#when(() => { this.#inner.disconnect(); });
  }

  send(name: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    this.#when(() => { this.#sendAs(false, name, kind, value); });
  }

  sendRaw(address: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    this.#when(() => { this.#sendAs(true, address, kind, value); });
  }

  /** The overloads only exist for callers; forwarding needs one concrete shape. */
  #sendAs(raw: boolean, name: string, kind: 'bool' | 'int' | 'float', value: boolean | number): void {
    const target = this.#inner;
    if (kind === 'bool') {
      if (raw) target.sendRaw(name, 'bool', value === true);
      else target.send(name, 'bool', value === true);
      return;
    }
    const number = typeof value === 'number' ? value : value ? 1 : 0;
    if (raw) target.sendRaw(name, kind, number);
    else target.send(name, kind, number);
  }

  onParam(listener: (event: OscParamEvent) => void): () => void {
    return lazySubscribe(this.#gate, oscPrompt(this.#gate.subject), this.#bag, () =>
      this.#inner.onParam(listener),
    );
  }

  onAvatarChange(listener: (event: OscAvatarChangeEvent) => void): () => void {
    return lazySubscribe(this.#gate, oscPrompt(this.#gate.subject), this.#bag, () =>
      this.#inner.onAvatarChange(listener),
    );
  }
}

export class GatedGameLog implements GameLogApi {
  readonly #inner: GameLogApi;
  readonly #gate: PluginGate;
  readonly #bag: DisposableBag;

  constructor(inner: GameLogApi, gate: PluginGate, bag: DisposableBag) {
    this.#inner = inner;
    this.#gate = gate;
    this.#bag = bag;
  }

  on(listener: (entry: GameLogEntry) => void): () => void {
    return lazySubscribe(this.#gate, gamelogPrompt(this.#gate.subject), this.#bag, () =>
      this.#inner.on(listener),
    );
  }

  onType(type: string, listener: (entry: GameLogEntry) => void): () => void {
    return this.on((entry) => {
      if (entry.type === type) listener(entry);
    });
  }

  async history(signal?: AbortSignal): Promise<readonly GameLogEntry[]> {
    await this.#gate.check(gamelogPrompt(this.#gate.subject));
    return this.#inner.history(signal);
  }
}
