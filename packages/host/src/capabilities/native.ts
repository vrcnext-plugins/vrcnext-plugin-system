/**
 * Client for the optional `vrcnext-bridge` daemon.
 *
 * The daemon is the only way a plugin reaches a UDP socket, D-Bus or a unix socket, because the
 * page itself cannot. Everything here is written for the case where it is **not installed**: that
 * is the normal state for most users, and it must produce a clean "unavailable", never a rejected
 * promise a plugin forgot to catch.
 *
 * # Two channels
 *
 * - A plain HTTP `GET /v1/health` is the probe. It answers one question — is anything listening —
 *   and is what separates {@link NativeStatus} `not_detected` from the other two states.
 * - One WebSocket, kept open for the life of the page, carries everything else: every service
 *   call, correlated by id so several can be in flight; the host's log records, mirrored to the
 *   daemon's log file so `tail -f` can follow plugin behaviour; and the daemon's own log lines,
 *   pushed back and shown in the Logs panel under the `bridge` scope.
 *
 * The probe deliberately sends `Content-Type: application/json`, which makes it non-simple and
 * forces a CORS preflight. That is half of the daemon's defence against arbitrary web pages
 * reaching it; the socket has no preflight, so the daemon checks its `Origin` header instead.
 */

import type {
  LogLevel,
  Logger,
  NativeApi,
  NativeDescription,
  NativeNotifyOptions,
  NativeNotifyResult,
  NativeStatus,
  NativeTarget,
} from '@vrcnext/plugin-api';

import type { LogRecord, LogSink } from '../log/log-sink.js';
import { BridgeSocket, NativeRequestError, REQUEST_TIMEOUT_MS } from './native-socket.js';

export { NativeRequestError, NativeTransportError } from './native-socket.js';

/** Where the daemon listens unless the user moved it. */
export const DEFAULT_NATIVE_ENDPOINT = 'http://127.0.0.1:42081';

/** Where a user-chosen endpoint is remembered. */
const ENDPOINT_KEY = 'vrcnext-plugins.native-endpoint';

/** How long to gather log records before sending a frame. */
const LOG_FLUSH_MS = 250;

/** Most log records held while disconnected. Oldest are dropped first. */
const LOG_MAX_QUEUED = 500;

/** Most log records per frame. Matches the daemon's own batch bound. */
const LOG_MAX_BATCH = 200;

/** Scope the daemon's own lines are shown under, and the one never mirrored back to it. */
const BRIDGE_SCOPE = 'bridge';

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

const UNAVAILABLE: NativeNotifyResult = { ok: false, delivered: [], failed: [] };

interface WireRecord {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly ts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function isWireRecord(value: unknown): value is WireRecord {
  return isRecord(value) && isLogLevel(value['level']) && typeof value['message'] === 'string';
}

export class NativeClient implements NativeApi {
  #endpoint: string;
  readonly #logger: Logger;
  #socket: BridgeSocket;
  #probed = false;
  #ready: Promise<boolean> | undefined;
  readonly #listeners = new Set<(status: NativeStatus) => void>();

  readonly #logQueue: WireRecord[] = [];
  #logTimer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribeSink: (() => void) | undefined;
  #sink: LogSink | undefined;

  constructor(logger: Logger, endpoint: string = storedEndpoint()) {
    this.#logger = logger;
    this.#endpoint = NativeClient.#normalise(endpoint);
    this.#socket = this.#openSocket();
  }

  static #normalise(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '');
  }

  /** `http://…` → `ws://…/v1/ws`. */
  static socketUrl(endpoint: string): string {
    return `${endpoint.replace(/^http/, 'ws')}/v1/ws`;
  }

  #openSocket(): BridgeSocket {
    const socket = new BridgeSocket(NativeClient.socketUrl(this.#endpoint), {
      onOpenChanged: (open) => {
        if (open) {
          this.#probed = true;
          this.#logger.info(`Bridge connected at ${this.#endpoint}.`);
          this.#flushLogs();
        }
        this.#notify();
      },
      onPush: (event, data) => { this.#onPush(event, data); },
    });
    socket.start();
    return socket;
  }

  /**
   * Point at a different daemon, persist the choice, and reconnect.
   *
   * The bridge's `--listen` is configurable, so this has to be too — otherwise a user who moves
   * the daemon has no way to tell the host, short of editing the bundle.
   *
   * @returns whether the new endpoint answered the health probe.
   */
  async setEndpoint(endpoint: string): Promise<boolean> {
    const next = NativeClient.#normalise(endpoint) || DEFAULT_NATIVE_ENDPOINT;
    this.#endpoint = next;
    this.#ready = undefined;
    try {
      if (next === DEFAULT_NATIVE_ENDPOINT) globalThis.localStorage.removeItem(ENDPOINT_KEY);
      else globalThis.localStorage.setItem(ENDPOINT_KEY, next);
    } catch {
      this.#logger.warn('Could not persist the bridge endpoint; it will reset on reload.');
    }
    this.#socket.stop();
    this.#socket = this.#openSocket();
    return this.probe();
  }

  get available(): boolean {
    return this.#probed || this.#socket.open;
  }

  get status(): NativeStatus {
    if (this.#socket.open) return 'connected';
    return this.#probed ? 'running_not_connected' : 'not_detected';
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

  get endpoint(): string {
    return this.#endpoint;
  }

  /** Be told whenever {@link status} changes. Returns the unsubscribe. */
  onStatus(listener: (status: NativeStatus) => void): () => void {
    this.#listeners.add(listener);
    return (): void => { this.#listeners.delete(listener); };
  }

  #notify(): void {
    const status = this.status;
    for (const listener of [...this.#listeners]) {
      try {
        listener(status);
      } catch {
        // A broken status indicator must not break the client.
      }
    }
  }

  async probe(): Promise<boolean> {
    try {
      const health = await this.#get('/v1/health');
      this.#probed = (health as { ok?: unknown }).ok === true;
    } catch {
      // Not running is the common case and not worth a warning on every boot.
      this.#probed = false;
    }
    this.#logger.info(
      this.#probed
        ? `Bridge detected at ${this.#endpoint}.`
        : `No bridge at ${this.#endpoint}; VR and desktop notification targets are unavailable.`,
    );
    this.#notify();
    return this.#probed;
  }

  async describe(): Promise<NativeDescription | undefined> {
    try {
      return (await this.#get('/v1/describe')) as NativeDescription;
    } catch (error) {
      this.#logger.debug(`describe() failed: ${String(error)}`);
      return undefined;
    }
  }

  async targets(): Promise<readonly NativeTarget[]> {
    try {
      const body = await this.call('notify', 'targets');
      const targets = (body as { targets?: unknown }).targets;
      return Array.isArray(targets) ? (targets as NativeTarget[]) : [];
    } catch (error) {
      this.#logger.debug(`targets() failed: ${String(error)}`);
      return [];
    }
  }

  async notify(options: NativeNotifyOptions): Promise<NativeNotifyResult> {
    try {
      return (await this.call('notify', 'send', options)) as NativeNotifyResult;
    } catch (error) {
      this.#logger.warn(`Native notification failed: ${String(error)}`);
      return UNAVAILABLE;
    }
  }

  call(service: string, method: string, params: unknown = {}): Promise<unknown> {
    return this.#socket.request(service, method, params);
  }

  /**
   * Mirror a sink's records to the daemon's log file, for as long as this client lives.
   *
   * Seeds from the sink's existing records first. The host logs several lines while booting —
   * the API version, the detected platform — and those are exactly the ones worth having when
   * diagnosing a broken start, so mirroring only *future* records would lose the best part.
   */
  mirrorLogs(sink: LogSink): void {
    this.#unsubscribeSink?.();
    this.#sink = sink;
    for (const record of sink.records) this.#enqueueLog(record);
    this.#unsubscribeSink = sink.subscribe((record) => { this.#enqueueLog(record); });
  }

  /** Close the socket and stop mirroring. */
  dispose(): void {
    this.#unsubscribeSink?.();
    this.#unsubscribeSink = undefined;
    this.#sink = undefined;
    if (this.#logTimer !== undefined) globalThis.clearTimeout(this.#logTimer);
    this.#logTimer = undefined;
    this.#logQueue.length = 0;
    this.#listeners.clear();
    this.#socket.stop();
  }

  #enqueueLog(record: LogRecord): void {
    // Never mirror the daemon's own lines back to it.
    if (record.scope === BRIDGE_SCOPE) return;

    this.#logQueue.push({
      level: record.level,
      scope: record.scope,
      message: record.message,
      ts: record.at,
    });
    // Drop from the front: when a buffer overflows during an outage, the newest lines are the
    // ones someone is actually debugging with.
    while (this.#logQueue.length > LOG_MAX_QUEUED) this.#logQueue.shift();

    this.#logTimer ??= globalThis.setTimeout(() => {
      this.#logTimer = undefined;
      this.#flushLogs();
    }, LOG_FLUSH_MS);
  }

  #flushLogs(): void {
    while (this.#logQueue.length > 0 && this.#socket.open) {
      const batch = this.#logQueue.slice(0, LOG_MAX_BATCH);
      if (!this.#socket.sendLogs(batch)) return;
      this.#logQueue.splice(0, batch.length);
    }
  }

  #onPush(event: string, data: unknown): void {
    if (event === 'log' && isWireRecord(data)) {
      this.#sink?.write(data.level, BRIDGE_SCOPE, data.message, []);
      return;
    }
    if (event === 'error' && isRecord(data)) {
      this.#logger.warn(`The bridge rejected a frame: ${String(data['message'])}`);
    }
  }

  /** One HTTP GET, with its own timeout. Only the probe and `describe` use HTTP. */
  async #get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await globalThis.fetch(`${this.#endpoint}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      const parsed: unknown = text === '' ? {} : JSON.parse(text);
      if (!response.ok) {
        const details = parsed as { error?: { code?: string; message?: string } };
        throw new NativeRequestError(
          details.error?.code ?? 'error',
          details.error?.message ?? `HTTP ${String(response.status)}`,
        );
      }
      return parsed;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}
