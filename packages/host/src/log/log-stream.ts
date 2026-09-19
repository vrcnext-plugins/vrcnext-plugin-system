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
 * line. Logs are multiplexed over {@link NativeClient}'s single WebSocket connection (`/v1/ws`).
 *
 * Nothing here ever throws into a caller: this sits behind `logger.info()`, and a logging call
 * that can fail is worse than no logging at all.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

import type { NativeClient } from '../capabilities/native.js';
import type { LogRecord, LogSink } from './log-sink.js';

/** How long to gather records before sending a frame. */
const FLUSH_MS = 250;

/** Most records held while disconnected. Oldest are dropped first. */
const MAX_QUEUED = 500;

/** Most records per frame. Matches the daemon's own batch bound. */
const MAX_BATCH = 200;

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
  return typeof value === 'string' &&
    (value === 'trace' || value === 'debug' || value === 'info' || value === 'warn' || value === 'error');
}

function isWireRecord(value: unknown): value is WireRecord {
  if (!isRecord(value)) return false;
  return isLogLevel(value['level']) &&
    typeof value['scope'] === 'string' &&
    typeof value['message'] === 'string';
}

export class LogStream {
  readonly #native: NativeClient;
  readonly #queue: WireRecord[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | undefined;
  #unsubscribeBroadcast: (() => void) | undefined;
  #sink: LogSink | undefined;

  constructor(native: NativeClient) {
    this.#native = native;
  }

  get connected(): boolean {
    return this.#native.connected;
  }

  /**
   * Subscribe to a sink and begin streaming. Safe to call when no daemon is running.
   *
   * Seeds from the sink's existing records first.
   */
  start(sink: LogSink): void {
    this.#sink = sink;
    this.#unsubscribe?.();
    this.#unsubscribeBroadcast?.();

    this.#unsubscribeBroadcast = this.#native.onLogBroadcast((records) => {
      this.#onBroadcastRecords(records);
    });

    for (const record of sink.records) this.#enqueue(record);
    this.#unsubscribe = sink.subscribe((record) => { this.#enqueue(record); });
  }

  stop(): void {
    this.#sink = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#unsubscribeBroadcast?.();
    this.#unsubscribeBroadcast = undefined;
    if (this.#timer !== undefined) globalThis.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#queue.length = 0;
  }

  #onBroadcastRecords(records: readonly unknown[]): void {
    if (this.#sink === undefined) return;
    for (const rec of records) {
      if (isWireRecord(rec)) {
        this.#sink.write(rec.level, rec.scope, rec.message, []);
      }
    }
  }

  #enqueue(record: LogRecord): void {
    // Never mirror logs that originated from the bridge back to the bridge.
    if (record.scope === 'bridge') return;

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
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, MAX_BATCH);
      const sent = this.#native.sendLogs(batch);
      if (!sent) {
        this.#queue.unshift(...batch);
        return;
      }
    }
  }
}
