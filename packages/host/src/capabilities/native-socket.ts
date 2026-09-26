/**
 * The one WebSocket the host keeps open to `vrcnext-bridge`.
 *
 * # Shape
 *
 * Every frame is a JSON envelope with a `type`. The page sends `request` frames, each with a
 * correlation id, and `logs` batches; the daemon answers requests under the same id and pushes
 * its own log lines unprompted. Several requests can be in flight, and they may be answered out
 * of order — a D-Bus round trip does not hold up a quick call.
 *
 * # Absence is the normal state
 *
 * Most users do not run the daemon. So: no console noise, no warnings, and a reconnect loop that
 * backs off to a slow poll rather than giving up, so a daemon started an hour into the session is
 * still picked up. A request made while the socket is down does not fail at once either: it
 * triggers an immediate connection attempt and waits up to its timeout, which is what makes the
 * first call after starting the daemon succeed instead of being the one that tells you to retry.
 */

/** Reconnect backoff, in milliseconds. Caps so a long-absent daemon is still picked up. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

/** Per-request ceiling. The daemon is local; anything slower than this is hung, not busy. */
export const REQUEST_TIMEOUT_MS = 4_000;

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

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'NativeRequestError';
    this.code = code;
  }
}

/** The socket went away, or never came, before the request was answered. */
export class NativeTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeTransportError';
  }
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface SocketHandlers {
  /** The socket opened or closed. */
  readonly onOpenChanged: (open: boolean) => void;
  /** The daemon sent something unprompted. */
  readonly onPush: (event: string, data: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorFrom(value: unknown): NativeRequestError {
  const shape: ErrorShape = isRecord(value) ? value : {};
  return new NativeRequestError(
    typeof shape.code === 'string' ? shape.code : 'error',
    typeof shape.message === 'string' ? shape.message : 'the daemon refused the request',
  );
}

export class BridgeSocket {
  readonly #url: string;
  readonly #handlers: SocketHandlers;
  readonly #pending = new Map<string, Pending>();
  #socket: WebSocket | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #nextId = 0;
  #stopped = true;
  /** Resolves when the socket next opens; replaced on close. */
  #opened: Promise<void>;
  #resolveOpened: () => void = () => undefined;

  /** @param url the daemon's socket, e.g. `ws://127.0.0.1:42081/v1/ws`. */
  constructor(url: string, handlers: SocketHandlers) {
    this.#url = url;
    this.#handlers = handlers;
    this.#opened = new Promise((resolve) => { this.#resolveOpened = resolve; });
  }

  get open(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  get url(): string {
    return this.#url;
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
    socket?.close();
    this.#rejectAll(new NativeTransportError('the connection was closed'));
  }

  /**
   * Call `service`/`method` and wait for the matching response.
   *
   * @throws {NativeRequestError} when the daemon answers with an error.
   * @throws {NativeTransportError} when the socket does not open in time, or closes first.
   */
  async request(service: string, method: string, params: unknown): Promise<unknown> {
    if (!this.open) await this.#waitForOpen();

    const socket = this.#socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      throw new NativeTransportError('the daemon is not connected');
    }

    this.#nextId += 1;
    const id = String(this.#nextId).slice(0, MAX_ID_CHARS);
    const frame = JSON.stringify({ type: 'request', id, service, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.#pending.delete(id);
        reject(new NativeTransportError(`${service}/${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
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
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify({ type: 'logs', records }));
      return true;
    } catch {
      return false;
    }
  }

  /** Wait for the socket to open, connecting now rather than waiting out the backoff. */
  async #waitForOpen(): Promise<void> {
    if (this.#stopped) return;
    if (this.#retry !== undefined) {
      globalThis.clearTimeout(this.#retry);
      this.#retry = undefined;
      this.#connect();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(resolve, REQUEST_TIMEOUT_MS);
    });
    await Promise.race([this.#opened, timeout]);
    globalThis.clearTimeout(timer);
  }

  #connect(): void {
    if (this.#stopped || this.#socket !== undefined) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.#url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#resolveOpened();
      this.#handlers.onOpenChanged(true);
    });
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.#onFrame(event.data);
    });
    // `error` is always followed by `close`, so everything is driven from one place.
    socket.addEventListener('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#opened = new Promise((resolve) => { this.#resolveOpened = resolve; });
      this.#rejectAll(new NativeTransportError('the daemon went away'));
      this.#handlers.onOpenChanged(false);
      this.#scheduleRetry();
    });
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

    if (frame['type'] === 'response' && typeof frame['id'] === 'string') {
      const pending = this.#settle(frame['id']);
      if (pending === undefined) return;
      if (frame['ok'] === true) pending.resolve(frame['result']);
      else pending.reject(errorFrom(frame['error']));
      return;
    }
    if (frame['type'] === 'push' && typeof frame['event'] === 'string') {
      this.#handlers.onPush(frame['event'], frame['data']);
    }
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
   * The daemon being absent is the common case, so this must stay quiet: no console noise, no
   * warnings. It is a background nicety, not a dependency.
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
