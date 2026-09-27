/**
 * Mirrors the host's log records into VRCNext's own Activity Log (Tools → Activity Log).
 *
 * VRCNext renders that page from a global `addLog(message, color)`: it keeps the last 500 rows,
 * derives a level label from a `[PREFIX]` in upper case or from the colour name, and defers the
 * DOM work while the tab is not on screen. This module only calls it. Debug records stay out —
 * the Activity Log is what someone reads to see what the app is doing, not a trace — and are
 * still in the Plugin System log panel and the bridge's file.
 *
 * Scopes are written as a lower-case `[scope]` prefix on purpose: VRCNext's prefix parser only
 * claims upper-case ones, so the scope stays in the message and the level comes from the colour.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

import type { LogRecord, LogSink } from './log-sink.js';

/** VRCNext's colour names for `addLog`, by level. Info has no colour: it is the default row. */
const COLOR_BY_LEVEL: Readonly<Record<LogLevel, string | undefined>> = {
  debug: undefined,
  info: undefined,
  warn: 'warn',
  error: 'err',
};

type AddLog = (message: string, color?: string) => void;

function addLog(): AddLog | undefined {
  const fn: unknown = (globalThis as { addLog?: unknown }).addLog;
  return typeof fn === 'function' ? (fn as AddLog) : undefined;
}

/** The one-line form VRCNext shows: `[scope] message detail…`. */
export function activityLine(record: LogRecord): string {
  const detail = record.detail.length > 0 ? ` ${record.detail.join(' ')}` : '';
  return `[${record.scope}] ${record.message}${detail}`;
}

/** Whether a record belongs in the Activity Log at all. */
export function isActivityWorthy(record: LogRecord): boolean {
  return record.level !== 'debug';
}

/** VRCNext's `addLog` drops the line when this element is missing, which it is during startup. */
const LOG_AREA_ID = 'logArea';

/** How often to look for the log area while VRCNext is still fetching its tab fragments. */
const READY_POLL_MS = 500;

/**
 * Starts mirroring `sink` into the Activity Log and returns the stop function.
 *
 * VRCNext fetches the Activity Log's markup after the page scripts run, and `addLog` silently
 * discards lines until it is there. So this waits for the log area, then replays what the sink
 * holds and follows it from then on. Does nothing, quietly, on a page that has no `addLog`.
 */
export function mirrorToActivityLog(sink: LogSink): () => void {
  const write = (record: LogRecord): void => {
    if (!isActivityWorthy(record)) return;
    addLog()?.(activityLine(record), COLOR_BY_LEVEL[record.level]);
  };

  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = (): void => {
    for (const record of sink.records) write(record);
    unsubscribe = sink.subscribe(write);
  };
  if (document.getElementById(LOG_AREA_ID) !== null) {
    start();
  } else {
    timer = globalThis.setInterval(() => {
      if (document.getElementById(LOG_AREA_ID) === null) return;
      globalThis.clearInterval(timer);
      timer = undefined;
      start();
    }, READY_POLL_MS);
  }

  return (): void => {
    if (timer !== undefined) globalThis.clearInterval(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  };
}
