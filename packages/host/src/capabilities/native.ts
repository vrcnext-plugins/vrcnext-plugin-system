/**
 * Client for the optional `vrcnext-bridge` companion.
 *
 * The companion is the only way a plugin reaches a UDP socket, D-Bus or a unix socket, because the
 * page itself cannot. Everything here is written for the case where it is **not installed**: that
 * is the normal state for most users, and it must produce a clean "unavailable", never a rejected
 * promise a plugin forgot to catch.
 *
 * All plugin calls are multiplexed over a single persistent WebSocket connection using correlation
 * IDs. The HTTP health probe is preserved to give the host an independent signal for detecting
 * a daemon that is running but not yet connected (the Platform Support tri-state).
 */

import type {
  Logger,
  NativeApi,
  NativeDescription,
  NativeNotifyOptions,
  NativeNotifyResult,
  NativeTarget,
} from '@vrcnext/plugin-api';

/** Where the companion listens unless the user moved it. */
export const DEFAULT_NATIVE_ENDPOINT = 'http://127.0.0.1:42081';

/** Where a user-chosen endpoint is remembered. */
const ENDPOINT_KEY = 'vrcnext-plugins.native-endpoint';

/**
 * The stored endpoint, or the default.
 *
 * `localStorage` rather than the host's IndexedDB because this is needed synchronously, during
 * construction, before the async storage layer is ready.
 */
export function storedEndpoint(): string {
  try {
    return globalThis.localStorage.getItem(ENDPOINT_KEY) ?? DEFAULT_NATIVE_ENDPOINT;
  } catch {
    return DEFAULT_NATIVE_ENDPOINT;
  }
}

/** Per-request ceiling. The companion is local; anything slower than this is hung, not busy. */
const TIMEOUT_MS = 4_000;

const UNAVAILABLE: NativeNotifyResult = { ok: false, delivered: [], failed: [] };

interface ErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export type NativeStatus = 'not_detected' | 'running_not_connected' | 'connected';

/** Reconnect backoff for WebSocket, in milliseconds. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

/**
 * The companion answered, and said no.
 *
 * Distinct from a transport failure on purpose: a 400 means the daemon is running and working —
 * the *request* was wrong. Conflating the two would let one malformed notification mark a
 * perfectly healthy companion as unavailable for the rest of the session.
 */
export class NativeRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(`${code}: ${message}`);
    this.name = 'NativeRequestError';
    this.code = code;
    this.status = status;
  }
}

export class NativeClient implements NativeApi {
  #endpoint: string;
  readonly #logger: Logger;
  #running = false;
  #ready: Promise<boolean> | undefined;

  #socket: WebSocket | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #stopped = false;
  #reqCounter = 0;
  readonly #pending = new Map<string, PendingCall>();
  readonly #broadcastListeners = new Set<(records: readonly unknown[]) => void>();

  constructor(logger: Logger, endpoint: string = storedEndpoint()) {
    this.#logger = logger;
    this.#endpoint = NativeClient.#normalise(endpoint);
  }

  static #normalise(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '');
  }

  /**
   * Point at a different companion, persist the choice, and re-probe.
   *
   * The bridge's `--listen` is configurable, so this has to be too — otherwise a user who moves
   * the daemon has no way to tell the host, short of editing the bundle.
   *
   * @returns whether the new endpoint answered.
   */
  async setEndpoint(endpoint: string): Promise<boolean> {
    const next = NativeClient.#normalise(endpoint) || DEFAULT_NATIVE_ENDPOINT;
    this.#endpoint = next;
    this.#ready = undefined;
    this.#disconnectWs();
    try {
      if (next === DEFAULT_NATIVE_ENDPOINT) globalThis.localStorage.removeItem(ENDPOINT_KEY);
      else globalThis.localStorage.setItem(ENDPOINT_KEY, next);
    } catch {
      this.#logger.warn('Could not persist the companion endpoint; it will reset on reload.');
    }
    return this.probe();
  }

  /** Whether the companion is reachable (running or connected). */
  get available(): boolean {
    return this.connected || this.#running;
  }

  /** Whether the HTTP probe succeeded. */
  get running(): boolean {
    return this.#running;
  }

  /** Whether the multiplexed WebSocket is connected and open. */
  get connected(): boolean {
    return this.#socket?.readyState === 1; // WebSocket.OPEN
  }

  /** Platform support tri-state: gray = not detected, yellow = running not connected, green = connected. */
  get status(): NativeStatus {
    if (this.connected) return 'connected';
    if (this.#running) return 'running_not_connected';
    return 'not_detected';
  }

  /** The companion's HTTP origin. */
  get endpoint(): string {
    return this.#endpoint;
  }

  /** `http://…` → `ws://…/v1/logs/stream`. */
  get wsUrl(): string {
    return `${this.#endpoint.replace(/^http/, 'ws')}/v1/logs/stream`;
  }

  /**
   * The boot-time probe, as a promise.
   *
   * {@link available} is a synchronous snapshot, and at the moment a plugin activates the probe
   * may still be in flight — so branching on it directly is a race that resolves differently
   * depending on how fast the daemon answers. Await this instead. Repeated reads share one probe.
   */
  get ready(): Promise<boolean> {
    this.#ready ??= this.probe();
    return this.#ready;
  }

  async probe(): Promise<boolean> {
    try {
      const health = await this.#request('GET', '/v1/health');
      this.#running = (health as { ok?: unknown }).ok === true;
    } catch {
      // Not running is the common case and not worth a warning on every boot.
      this.#running = false;
    }

    if (this.#running && !this.connected) {
      this.connectWs();
    }

    this.#logger.info(
      this.#running
        ? `Native companion reachable at ${this.#endpoint}.`
        : `No native companion at ${this.#endpoint}; VR and desktop notification targets are unavailable.`,
    );
    return this.#running;
  }

  /** Open the persistent multiplexed WebSocket connection if supported and not yet open. */
  connectWs(): void {
    if (this.#stopped || this.#socket !== undefined) return;
    if (typeof globalThis.WebSocket === 'undefined') return;

    let socket: WebSocket;
    try {
      socket = new globalThis.WebSocket(this.wsUrl);
    } catch {
      this.#scheduleReconnect();
      return;
    }

    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#logger.debug(`WebSocket connected to companion at ${this.wsUrl}`);
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      this.#onWsMessage(event.data);
    });

    socket.addEventListener('close', () => {
      this.#socket = undefined;
      this.#rejectAllPending(new NativeRequestError('unavailable', 503, 'WebSocket connection closed'));
      this.#scheduleReconnect();
    });
  }

  #disconnectWs(): void {
    if (this.#reconnectTimer !== undefined) {
      globalThis.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    if (this.#socket !== undefined) {
      try {
        this.#socket.close();
      } catch {
        // Socket already closing
      }
      this.#socket = undefined;
    }
    this.#rejectAllPending(new NativeRequestError('unavailable', 503, 'WebSocket disconnected'));
  }

  #rejectAllPending(error: Error): void {
    for (const [, call] of this.#pending) {
      globalThis.clearTimeout(call.timer);
      call.reject(error);
    }
    this.#pending.clear();
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== undefined) return;
    const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.#attempt += 1;
    this.#reconnectTimer = globalThis.setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.connectWs();
    }, delay);
  }

  #onWsMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const msg: unknown = JSON.parse(data);
      if (typeof msg !== 'object' || msg === null) return;

      const record = msg as Record<string, unknown>;
      if (record['type'] === 'response') {
        this.#handleResponse(record);
      } else if (record['type'] === 'push' && record['event'] === 'logBroadcast') {
        this.#handlePush(record['data']);
      } else if (Array.isArray(record['records'])) {
        // Legacy broadcast format
        for (const listener of this.#broadcastListeners) listener(record['records'] as unknown[]);
      }
    } catch {
      // Silently ignore malformed frames
    }
  }

  #handleResponse(record: Record<string, unknown>): void {
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    const pending = this.#pending.get(id);
    if (pending === undefined) return;

    this.#pending.delete(id);
    globalThis.clearTimeout(pending.timer);
    if (record['ok'] === true) {
      pending.resolve(record['result']);
      return;
    }

    const err = record['error'] as { code?: string; message?: string } | undefined;
    pending.reject(new NativeRequestError(
      err?.code ?? 'error',
      400,
      err?.message ?? 'call failed',
    ));
  }

  #handlePush(payload: unknown): void {
    const records = Array.isArray(payload)
      ? payload
      : (typeof payload === 'object' && payload !== null && Array.isArray((payload as Record<string, unknown>)['records']))
        ? (payload as { records: unknown[] }).records
        : [];
    for (const listener of this.#broadcastListeners) listener(records);
  }

  /**
   * Send a log batch over the WebSocket connection.
   *
   * @returns whether the frame was queued for transmission.
   */
  sendLogs(records: readonly unknown[]): boolean {
    if (this.#socket?.readyState === 1) { // WebSocket.OPEN
      try {
        this.#socket.send(JSON.stringify({ type: 'logs', records }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Subscribe to daemon log broadcasts received over the WebSocket. */
  onLogBroadcast(listener: (records: readonly unknown[]) => void): () => void {
    this.#broadcastListeners.add(listener);
    return () => {
      this.#broadcastListeners.delete(listener);
    };
  }

  async describe(): Promise<NativeDescription | undefined> {
    try {
      if (this.connected) {
        return (await this.call('describe', 'describe', {})) as NativeDescription;
      }
      return (await this.#request('GET', '/v1/describe')) as NativeDescription;
    } catch (error) {
      this.#logger.debug(`describe() failed: ${String(error)}`);
      return undefined;
    }
  }

  async targets(): Promise<readonly NativeTarget[]> {
    try {
      const body = await this.call('notify', 'targets', {});
      const targets = (body as { targets?: unknown }).targets;
      return Array.isArray(targets) ? (targets as NativeTarget[]) : [];
    } catch (error) {
      this.#logger.debug(`targets() failed: ${String(error)}`);
      return [];
    }
  }

  async notify(options: NativeNotifyOptions): Promise<NativeNotifyResult> {
    try {
      const body = await this.call('notify', 'send', options);
      return body as NativeNotifyResult;
    } catch (error) {
      // Only a transport failure says anything about availability. A rejected request means the
      // companion is alive and the caller got it wrong.
      if (!(error instanceof NativeRequestError)) {
        this.#running = false;
      }
      this.#logger.warn(`Native notification failed: ${String(error)}`);
      return UNAVAILABLE;
    }
  }

  /**
   * Execute a service method with correlation ID multiplexing.
   *
   * Uses WebSocket if connected; falls back to HTTP POST for legacy/offline environments.
   */
  async call(service: string, method: string, params: unknown = {}): Promise<unknown> {
    if (this.connected) {
      return this.#callWs(service, method, params);
    }
    return this.#request('POST', `/v1/${service}/${method}`, params);
  }

  #callWs(service: string, method: string, params: unknown): Promise<unknown> {
    const socket = this.#socket;
    if (socket?.readyState !== 1) {
      throw new NativeRequestError('unavailable', 503, 'WebSocket is not open');
    }

    const id = `req-${String(++this.#reqCounter)}-${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.#pending.delete(id);
        reject(new NativeRequestError('timeout', 504, 'request timed out'));
      }, TIMEOUT_MS);

      this.#pending.set(id, { resolve, reject, timer });

      try {
        socket.send(JSON.stringify({
          type: 'request',
          id,
          service,
          method,
          params: params ?? {},
        }));
      } catch (err) {
        globalThis.clearTimeout(timer);
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * One request, with its own timeout.
   *
   * A non-2xx answer carries the companion's own error code and message; surfacing that verbatim
   * is far more useful to a plugin author than "HTTP 400".
   */
  async #request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { controller.abort(); }, TIMEOUT_MS);

    try {
      const response = await globalThis.fetch(`${this.#endpoint}${path}`, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      const parsed: unknown = text === '' ? {} : JSON.parse(text);

      // Reached it either way, so record that before deciding whether the answer was a refusal.
      this.#running = true;

      if (!response.ok) {
        const details = parsed as ErrorBody;
        throw new NativeRequestError(
          details.error?.code ?? 'error',
          response.status,
          details.error?.message ?? `HTTP ${String(response.status)}`,
        );
      }
      return parsed;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  /** Stop background reconnection and close any open WebSocket. */
  dispose(): void {
    this.#stopped = true;
    this.#disconnectWs();
  }
}
