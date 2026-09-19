/**
 * Streams the host's log records to the native companion, which writes them to a file.
 *
 * # Why
 *
 * VRCNext's activity log is written by its C# side and there is no page→C# action that logs
 * arbitrary text, so the plugin system cannot get a line into it. Without this, following plugin
 * behaviour means keeping the Logs panel open and copying text out by hand — no use for watching a
 * bug over time, and no use for anyone helping remotely. With the companion running there is a
 * real file that `tail -f` can follow.
 *
 * # Shape
 *
 * Fire-and-forget and entirely optional. Records are batched on a short timer rather than sent per
 * line, because a chatty plugin would otherwise produce a frame per record. If the socket is down,
 * records queue up to a bounded buffer and flush on reconnect; past that bound the **oldest** are
 * dropped, since the newest lines are the ones someone debugging actually wants.
 *
 * Nothing here ever throws into a caller: this sits behind `logger.info()`, and a logging call
 * that can fail is worse than no logging at all.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

import type { LogRecord, LogSink } from './log-sink.js';

/** How long to gather records before sending a frame. */
const FLUSH_MS = 250;

/** Most records held while disconnected. Oldest are dropped first. */
const MAX_QUEUED = 500;

/** Most records per frame. Matches the daemon's own batch bound. */
const MAX_BATCH = 200;

/** Reconnect backoff, in milliseconds. Caps so a long-absent daemon is still picked up. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

interface WireRecord {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly ts: number;
}

export class LogStream {
  readonly #endpoint: string;
  readonly #queue: WireRecord[] = [];
  #socket: WebSocket | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #stopped = false;
  #unsubscribe: (() => void) | undefined;

  /** @param endpoint the companion's HTTP origin, e.g. `http://127.0.0.1:42081`. */
  constructor(endpoint: string) {
    this.#endpoint = endpoint;
  }

  /** `http://…` → `ws://…/v1/logs/stream`. */
  get url(): string {
    return `${this.#endpoint.replace(/^http/, 'ws')}/v1/logs/stream`;
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to a sink and begin streaming. Safe to call when no daemon is running.
   *
   * Seeds from the sink's existing records first. The host logs several lines while booting —
   * the API version, the detected platform — and those are exactly the ones worth having when
   * diagnosing a broken start, so subscribing to only *future* records would lose the best part.
   */
  start(sink: LogSink): void {
    this.#stopped = false;
    this.#unsubscribe?.();
    for (const record of sink.records) this.#enqueue(record);
    this.#unsubscribe = sink.subscribe((record) => { this.#enqueue(record); });
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#timer !== undefined) globalThis.clearTimeout(this.#timer);
    if (this.#retry !== undefined) globalThis.clearTimeout(this.#retry);
    this.#timer = undefined;
    this.#retry = undefined;
    this.#socket?.close();
    this.#socket = undefined;
    this.#queue.length = 0;
  }

  #enqueue(record: LogRecord): void {
    this.#queue.push({
      level: record.level,
      scope: record.scope,
      message: record.message,
      ts: record.at,
    });
    // Drop from the front: when a buffer overflows during an outage, the newest lines are the
    // ones someone is actually debugging with.
    while (this.#queue.length > MAX_QUEUED) this.#queue.shift();

    this.#timer ??= globalThis.setTimeout(() => {
      this.#timer = undefined;
      this.#flush();
    }, FLUSH_MS);
  }

  #flush(): void {
    const socket = this.#socket;
    if (socket?.readyState !== WebSocket.OPEN) return;

    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, MAX_BATCH);
      try {
        socket.send(JSON.stringify({ records: batch }));
      } catch {
        // Put them back and wait for the socket to settle; never throw into the logger.
        this.#queue.unshift(...batch);
        return;
      }
    }
  }

  #connect(): void {
    if (this.#stopped || this.#socket !== undefined) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#flush();
    });

    // `error` is always followed by `close`, so reconnection is driven from one place.
    socket.addEventListener('close', () => {
      this.#socket = undefined;
      this.#scheduleRetry();
    });
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
