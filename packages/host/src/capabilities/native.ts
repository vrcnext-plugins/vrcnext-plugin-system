/**
 * Client for the VRCNext Bridge daemon.
 *
 * The bridge is mandatory: it owns the plugin clones, the state store and the build. The host
 * therefore does nothing plugin-related until this client reports `connected`, and the Plugins
 * tab shows the four states below so the user can see which step is missing.
 *
 * # Two channels
 *
 * - A plain HTTP `GET /v1/health` is the probe. It needs no token and answers one question — is
 *   anything listening — which separates `not_detected` from the other three states.
 * - One WebSocket, kept open for the life of the page, carries everything else: every service
 *   call, correlated by id so several can be in flight; the host's log records, mirrored to the
 *   daemon's log file; and the daemon's pushes (its own log lines, build results, progress).
 *
 * The probe deliberately sends `Content-Type: application/json`, which makes it non-simple and
 * forces a CORS preflight. That is half of the daemon's defence against arbitrary web pages
 * reaching it; the socket has no preflight, so the daemon checks its `Origin` header instead.
 *
 * # Pairing
 *
 * The socket's first frame is a `hello` carrying the pairing token from `localStorage`. A
 * refused hello closes the socket with code 1008 and the client stops retrying — only a new
 * token, or an explicit re-check, opens it again — because every failed hello costs one of the
 * bridge's rate-limit tokens.
 */

import type { LogLevel, Logger } from '@vrcnext/plugin-api';

import type { LogRecord, LogSink } from '../log/log-sink.js';
import {
  BridgeSocket,
  REQUEST_TIMEOUT_MS,
  type RequestOptions,
  type Welcome,
} from './native-socket.js';

export { NativeRequestError, NativeTransportError } from './native-socket.js';
export type { RequestOptions, Welcome } from './native-socket.js';

/** Where the daemon listens unless the user moved it. */
export const DEFAULT_NATIVE_ENDPOINT = 'http://127.0.0.1:42081';

/** Where a user-chosen endpoint is remembered. */
export const ENDPOINT_KEY = 'vrcnext-plugins.native-endpoint';

/** Where the pairing token is remembered. */
export const TOKEN_KEY = 'vrcnext-plugins.token';

/**
 * The bridge as the page sees it.
 *
 * `unpaired` means the daemon answered the probe but refused the hello: the token is missing or
 * wrong. `running_not_connected` is the transient state while the socket is being (re)opened.
 */
export type BridgeStatus = 'not_detected' | 'running_not_connected' | 'unpaired' | 'connected';

/** How long to gather log records before sending a frame. */
const LOG_FLUSH_MS = 250;

/** Most log records held while disconnected. Oldest are dropped first. */
const LOG_MAX_QUEUED = 500;

/** Most log records per frame. Matches the daemon's own batch bound. */
const LOG_MAX_BATCH = 200;

/** Scope the daemon's own lines are shown under, and the one never mirrored back to it. */
const BRIDGE_SCOPE = 'bridge';

function readStored(key: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: string | undefined): boolean {
  try {
    if (value === undefined) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The stored endpoint, or the default. */
export function storedEndpoint(): string {
  return readStored(ENDPOINT_KEY) ?? DEFAULT_NATIVE_ENDPOINT;
}

/**
 * The stored pairing token, or empty. Read once, by the one {@link BridgeClient}, which keeps it
 * in a private field and never hands it out again.
 */
function storedToken(): string {
  return readStored(TOKEN_KEY) ?? '';
}

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

export interface BridgeClientOptions {
  readonly endpoint?: string;
  readonly token?: string;
  /** Client identification for the hello, `vrcnext-plugin-system/<version>`. */
  readonly client: string;
}

export type PushListener = (event: string, data: unknown) => void;

export class BridgeClient {
  #endpoint: string;
  #token: string;
  readonly #client: string;
  readonly #logger: Logger;
  #socket: BridgeSocket | undefined;
  #welcome: Welcome | undefined;
  #probed = false;
  #refused = false;
  readonly #statusListeners = new Set<(status: BridgeStatus) => void>();
  readonly #pushListeners = new Set<PushListener>();

  readonly #logQueue: WireRecord[] = [];
  #logTimer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribeSink: (() => void) | undefined;
  #sink: LogSink | undefined;

  constructor(logger: Logger, options: BridgeClientOptions) {
    this.#logger = logger;
    this.#client = options.client;
    this.#endpoint = BridgeClient.#normalise(options.endpoint ?? storedEndpoint());
    this.#token = (options.token ?? storedToken()).trim();
    this.#openSocket();
  }

  static #normalise(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '');
  }

  /** `http://…` → `ws://…/v1/ws`. */
  static socketUrl(endpoint: string): string {
    return `${endpoint.replace(/^http/, 'ws')}/v1/ws`;
  }

  /**
   * Opens the socket, unless there is no token: a hello without one is refused and costs a
   * rate-limit token, and the Bridge card already tells the user what to paste.
   */
  #openSocket(): void {
    this.#socket?.stop();
    this.#socket = undefined;
    this.#refused = false;
    if (this.#token === '') return;

    const socket = new BridgeSocket(
      { url: BridgeClient.socketUrl(this.#endpoint), token: this.#token, client: this.#client },
      {
        // A socket that opened proves a daemon is there, whatever it says next.
        onOpen: () => {
          this.#probed = true;
          this.#notify();
        },
        onWelcome: (welcome) => {
          this.#welcome = welcome;
          this.#probed = true;
          this.#logger.info(`Bridge ${welcome.version} connected at ${this.#endpoint}.`);
          this.#flushLogs();
          this.#notify();
        },
        onClose: (info) => {
          this.#refused = info.refused;
          if (info.refused) {
            this.#probed = true;
            this.#logger.warn(`The bridge refused the pairing (${info.reason || 'no reason'}).`);
          } else if (info.welcomed) {
            this.#logger.info('The bridge went away; reconnecting in the background.');
            // Re-probe so a stopped daemon reads as "not detected" rather than "running".
            void this.probe();
          }
          this.#notify();
        },
        onPush: (event, data) => { this.#onPush(event, data); },
      },
    );
    this.#socket = socket;
    socket.start();
  }

  get status(): BridgeStatus {
    if (this.#socket?.open === true) return 'connected';
    if (this.#refused || (this.#probed && this.#token === '')) return 'unpaired';
    return this.#probed ? 'running_not_connected' : 'not_detected';
  }

  get endpoint(): string {
    return this.#endpoint;
  }

  /**
   * Whether a pairing token is set. The token itself has no getter: it lives in a private field
   * and goes only into the hello, so nothing that can reach this client — the host handle, a
   * plugin holding a reference — can read it back. localStorage still has it, for the next
   * load; the bridge's source policy keeps plugin code from reading that.
   */
  get paired(): boolean {
    return this.#token !== '';
  }

  /** What the bridge said about itself in its welcome, or `undefined` before the first one. */
  describe(): Welcome | undefined {
    return this.#welcome;
  }

  /** Be told whenever {@link status} changes. Returns the unsubscribe. */
  onStatus(listener: (status: BridgeStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return (): void => { this.#statusListeners.delete(listener); };
  }

  /** Be told about every push the bridge sends, except `log` and `error` which are handled here. */
  onPush(listener: PushListener): () => void {
    this.#pushListeners.add(listener);
    return (): void => { this.#pushListeners.delete(listener); };
  }

  #notify(): void {
    const status = this.status;
    for (const listener of [...this.#statusListeners]) {
      try {
        listener(status);
      } catch {
        // A broken status indicator must not break the client.
      }
    }
  }

  /**
   * Point at a different daemon, persist the choice, and reconnect.
   *
   * The bridge's `--listen` is configurable, so this has to be too.
   */
  setEndpoint(endpoint: string): void {
    const next = BridgeClient.#normalise(endpoint) || DEFAULT_NATIVE_ENDPOINT;
    this.#endpoint = next;
    this.#probed = false;
    if (!writeStored(ENDPOINT_KEY, next === DEFAULT_NATIVE_ENDPOINT ? undefined : next)) {
      this.#logger.warn('Could not persist the bridge endpoint; it will reset on reload.');
    }
    this.#openSocket();
    void this.probe();
  }

  /** Store a new pairing token and try it at once. */
  setToken(token: string): void {
    this.#token = token.trim();
    if (!writeStored(TOKEN_KEY, this.#token === '' ? undefined : this.#token)) {
      this.#logger.warn('Could not persist the pairing token; it will be asked for again on reload.');
    }
    this.#openSocket();
    this.#notify();
  }

  /** Probe again and, if the socket was refused or never opened, try the hello again. */
  recheck(): Promise<boolean> {
    if (this.#socket?.open !== true) this.#openSocket();
    return this.probe();
  }

  async probe(): Promise<boolean> {
    try {
      const health = await this.#get('/v1/health');
      this.#probed = (health as { ok?: unknown }).ok === true;
    } catch {
      // Not running is a normal state and not worth a warning on every boot.
      this.#probed = false;
    }
    this.#logger.debug(
      this.#probed ? `Bridge detected at ${this.#endpoint}.` : `No bridge at ${this.#endpoint}.`,
    );
    this.#notify();
    return this.#probed;
  }

  /**
   * Call any service method over the shared socket.
   *
   * @throws {NativeRequestError} when the bridge answers with an error.
   * @throws {NativeTransportError} when the socket is down or the call times out.
   */
  call(service: string, method: string, params: unknown = {}, options?: RequestOptions): Promise<unknown> {
    const socket = this.#socket;
    if (socket === undefined) {
      return Promise.reject(new Error('The bridge is not paired.'));
    }
    return socket.request(service, method, params, options);
  }

  /**
   * Mirror a sink's records to the daemon's log file, for as long as this client lives.
   *
   * Seeds from the sink's existing records first: the host logs several lines while booting and
   * those are exactly the ones worth having when diagnosing a broken start.
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
    this.#statusListeners.clear();
    this.#pushListeners.clear();
    this.#socket?.stop();
    this.#socket = undefined;
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
    const socket = this.#socket;
    if (socket === undefined) return;
    while (this.#logQueue.length > 0 && socket.open) {
      const batch = this.#logQueue.slice(0, LOG_MAX_BATCH);
      if (!socket.sendLogs(batch)) return;
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
      return;
    }
    for (const listener of [...this.#pushListeners]) {
      try {
        listener(event, data);
      } catch (error) {
        this.#logger.error(`A push listener for "${event}" threw`, error);
      }
    }
  }

  /** One HTTP GET, with its own timeout. Only the probe uses HTTP. */
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
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return text === '' ? {} : (JSON.parse(text) as unknown);
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}
