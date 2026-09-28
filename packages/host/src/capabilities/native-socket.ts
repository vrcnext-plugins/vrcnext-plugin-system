/**
 * The one WebSocket the host keeps open to `vrcnext-bridge`.
 *
 * # Shape
 *
 * Every frame is a JSON envelope with a `type`. The first frame the page sends is `hello`,
 * carrying the pairing token; the bridge answers `welcome` and only then accepts anything else.
 * After that the page sends `request` frames, each with a correlation id, and `logs` batches;
 * the bridge answers requests under the same id and pushes events unprompted. Several requests
 * can be in flight, and they may be answered out of order.
 *
 * # Two ways to be closed
 *
 * A socket that closes with code 1008 was *refused*: the token is wrong or the hello came too
 * late. Reconnecting would burn the bridge's rate limit and never succeed, so this class stops
 * and reports the reason; the client reconnects only when the user changes the token. Any other
 * close is a bridge that is not running or went away, which is retried with backoff forever so a
 * daemon started an hour into the session is still picked up.
 */

/** Reconnect backoff, in milliseconds. Caps so a long-absent daemon is still picked up. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

/** Per-request ceiling. The daemon is local; anything slower than this is hung, not busy. */
export const REQUEST_TIMEOUT_MS = 4_000;

/**
 * Ceiling for a call made while the socket is down. Long enough for the reconnect backoff to
 * fire once and the hello to be answered; the first call after starting the daemon should
 * succeed instead of being the one that tells you to retry.
 */
const OPEN_TIMEOUT_MS = REQUEST_TIMEOUT_MS;

/** WebSocket close code the bridge uses for a refused hello. */
export const CLOSE_POLICY_VIOLATION = 1008;

/** Longest correlation id the daemon accepts. Ours are short integers; this documents the bound. */
const MAX_ID_CHARS = 128;

interface ErrorShape {
  readonly code?: unknown;
  readonly message?: unknown;
}

/**
 * The daemon answered, and said no.
 *
 * Distinct from a transport failure on purpose: a `bad_request` means the daemon is running and
 * working — the *request* was wrong. Conflating the two would let one malformed notification mark
 * a perfectly healthy daemon as gone.
 */
export class NativeRequestError extends Error {
  readonly code: string;
  /** The bridge's message as sent, without the code prefix; its stable sub-code comes first. */
  readonly detail: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'NativeRequestError';
    this.code = code;
    this.detail = message;
  }
}

/** The socket went away, or never came, before the request was answered. */
export class NativeTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeTransportError';
  }
}

/** What the bridge says about itself once the hello is accepted. */
export interface Welcome {
  readonly version: string;
  /** Service names and their self-description. */
  readonly services: Readonly<Record<string, unknown>>;
}

export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
  /** Whether the hello had been accepted before the close. */
  readonly welcomed: boolean;
  /** True for code 1008: the bridge refused the pairing, so no retry is scheduled. */
  readonly refused: boolean;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface SocketHandlers {
  /** The TCP connection is up and the hello has been sent. Something is listening. */
  readonly onOpen: () => void;
  /** The hello was accepted; the socket is usable. */
  readonly onWelcome: (welcome: Welcome) => void;
  /** The socket closed, or the connection attempt failed. */
  readonly onClose: (info: CloseInfo) => void;
  /** The daemon sent something unprompted. */
  readonly onPush: (event: string, data: unknown) => void;
}

export interface RequestOptions {
  /** Ceiling for this one call. Defaults to {@link REQUEST_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /**
   * Stops waiting for the answer. The wire protocol has no cancel frame, so the bridge may still
   * finish the call; its answer is dropped and the promise rejects with the signal's reason.
   */
  readonly signal?: AbortSignal;
}

export interface SocketOptions {
  /** The daemon's socket, e.g. `ws://127.0.0.1:42081/v1/ws`. */
  readonly url: string;
  /** Pairing token, sent in the hello. */
  readonly token: string;
  /** Client identification sent in the hello, `vrcnext-plugin-system/<version>`. */
  readonly client: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The signal's reason when it is an Error, else the `AbortError` a plain `abort()` would give. */
function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('The request was aborted.', 'AbortError');
}

function errorFrom(value: unknown): NativeRequestError {
  const shape: ErrorShape = isRecord(value) ? value : {};
  return new NativeRequestError(
    typeof shape.code === 'string' ? shape.code : 'error',
    typeof shape.message === 'string' ? shape.message : 'the daemon refused the request',
  );
}

function welcomeFrom(frame: Record<string, unknown>): Welcome {
  const services = frame['services'];
  return {
    version: typeof frame['version'] === 'string' ? frame['version'] : 'unknown',
    services: isRecord(services) ? services : {},
  };
}

export class BridgeSocket {
  readonly #options: SocketOptions;
  readonly #handlers: SocketHandlers;
  readonly #pending = new Map<string, Pending>();
  #socket: WebSocket | undefined;
  #welcomed = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #nextId = 0;
  #stopped = true;
  /** Resolves when the hello is next accepted; replaced on close. */
  #opened: Promise<void>;
  #resolveOpened: () => void = () => undefined;

  constructor(options: SocketOptions, handlers: SocketHandlers) {
    this.#options = options;
    this.#handlers = handlers;
    this.#opened = new Promise((resolve) => { this.#resolveOpened = resolve; });
  }

  /** Whether the hello has been accepted on the current socket. */
  get open(): boolean {
    return this.#welcomed && this.#socket?.readyState === WebSocket.OPEN;
  }

  get url(): string {
    return this.#options.url;
  }

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  /** Close and stop reconnecting. Every pending request is rejected. */
  stop(): void {
    this.#stopped = true;
    if (this.#retry !== undefined) globalThis.clearTimeout(this.#retry);
    this.#retry = undefined;
    const socket = this.#socket;
    this.#socket = undefined;
    this.#welcomed = false;
    socket?.close();
    this.#rejectAll(new NativeTransportError('the connection was closed'));
  }

  /**
   * Call `service`/`method` and wait for the matching response.
   *
   * `timeoutMs` is per call because the bridge confirms installs, updates and uninstalls on the
   * desktop, and a user may take a while to click; the default suits a local round trip.
   *
   * @throws {NativeRequestError} when the daemon answers with an error.
   * @throws {NativeTransportError} when the socket is not welcomed in time, or closes first.
   */
  async request(
    service: string,
    method: string,
    params: unknown,
    options?: RequestOptions,
  ): Promise<unknown> {
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const signal = options?.signal;
    signal?.throwIfAborted();
    if (!this.open) await this.#waitForOpen();
    signal?.throwIfAborted();

    const socket = this.#socket;
    if (!this.open || socket === undefined) {
      throw new NativeTransportError('the bridge is not connected');
    }

    this.#nextId += 1;
    const id = String(this.#nextId).slice(0, MAX_ID_CHARS);
    const frame = JSON.stringify({ type: 'request', id, service, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        this.#settle(id)?.reject(abortReason(signal));
      };
      const timer = globalThis.setTimeout(() => {
        this.#settle(id)?.reject(new NativeTransportError(`${service}/${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => { signal?.removeEventListener('abort', onAbort); resolve(value); },
        reject: (reason: Error) => { signal?.removeEventListener('abort', onAbort); reject(reason); },
        timer,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        socket.send(frame);
      } catch (error) {
        this.#settle(id)?.reject(new NativeTransportError(String(error)));
      }
    });
  }

  /**
   * Send a batch of log records. Fire-and-forget.
   *
   * @returns whether the batch was handed to the socket. A `false` means "still queued".
   */
  sendLogs(records: readonly unknown[]): boolean {
    const socket = this.#socket;
    if (!this.open || socket === undefined) return false;
    try {
      socket.send(JSON.stringify({ type: 'logs', records }));
      return true;
    } catch {
      return false;
    }
  }

  /** Wait for the hello to be accepted, connecting now rather than waiting out the backoff. */
  async #waitForOpen(): Promise<void> {
    if (this.#stopped) return;
    if (this.#retry !== undefined) {
      globalThis.clearTimeout(this.#retry);
      this.#retry = undefined;
      this.#connect();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(resolve, OPEN_TIMEOUT_MS);
    });
    await Promise.race([this.#opened, timeout]);
    globalThis.clearTimeout(timer);
  }

  #connect(): void {
    if (this.#stopped || this.#socket !== undefined) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.#options.url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    // The hello must be the first frame; nothing else is sent until the welcome arrives.
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({ type: 'hello', token: this.#options.token, client: this.#options.client }),
      );
      this.#handlers.onOpen();
    });
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.#onFrame(event.data);
    });
    // `error` is always followed by `close`, so everything is driven from one place.
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.#socket !== socket) return;
      this.#onClose(event.code, event.reason);
    });
  }

  #onClose(code: number, reason: string): void {
    const welcomed = this.#welcomed;
    const refused = code === CLOSE_POLICY_VIOLATION;
    this.#socket = undefined;
    this.#welcomed = false;
    this.#opened = new Promise((resolve) => { this.#resolveOpened = resolve; });
    this.#rejectAll(new NativeTransportError('the bridge went away'));
    this.#handlers.onClose({ code, reason, welcomed, refused });
    // A refused pairing will be refused again; only a new token can change that.
    if (!refused) this.#scheduleRetry();
  }

  #onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(frame)) return;

    switch (frame['type']) {
      case 'welcome':
        this.#welcomed = true;
        this.#attempt = 0;
        this.#resolveOpened();
        this.#handlers.onWelcome(welcomeFrom(frame));
        return;
      case 'response':
        this.#onResponse(frame);
        return;
      case 'push':
        if (typeof frame['event'] === 'string') this.#handlers.onPush(frame['event'], frame['data']);
        return;
      default:
        return;
    }
  }

  #onResponse(frame: Record<string, unknown>): void {
    if (typeof frame['id'] !== 'string') return;
    const pending = this.#settle(frame['id']);
    if (pending === undefined) return;
    if (frame['ok'] === true) pending.resolve(frame['result']);
    else pending.reject(errorFrom(frame['error']));
  }

  /** Take a pending request out of the table, clearing its timer. */
  #settle(id: string): Pending | undefined {
    const pending = this.#pending.get(id);
    if (pending === undefined) return undefined;
    this.#pending.delete(id);
    globalThis.clearTimeout(pending.timer);
    return pending;
  }

  #rejectAll(error: Error): void {
    for (const [id, pending] of [...this.#pending]) {
      this.#pending.delete(id);
      globalThis.clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  /**
   * Retry with backoff.
   *
   * A stopped daemon must stay quiet: no console noise, no warnings. The Bridge card is where the
   * user learns about it.
   */
  #scheduleRetry(): void {
    if (this.#stopped || this.#retry !== undefined) return;
    const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.#attempt += 1;
    this.#retry = globalThis.setTimeout(() => {
      this.#retry = undefined;
      this.#connect();
    }, delay);
  }
}
