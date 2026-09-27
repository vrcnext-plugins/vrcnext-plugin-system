/**
 * Central log sink.
 *
 * > [!IMPORTANT]
 * > **This cannot write to VRCNext's own `Logs/` file.** VRCNext appends to that file inside
 * > `AppShell.SendToJS` — the C#→page direction — and exposes no page→C# action that logs
 * > arbitrary text. The page has no filesystem access either. So "follow what plugins are
 * > doing without reading the browser console" is served three other ways instead:
 * >
 * > 1. A live **Logs panel** under Plugin System in Settings.
 * > 2. **Mirroring to the VRCNext Bridge**, which appends every record to its `plugins.log`.
 * > 3. **Download as a `.log` file**, which is a real file on disk.
 * > 4. **Mirroring into VRCNext's Activity Log** (info and above), through the page's `addLog`.
 *
 * Records are kept in a ring buffer so a chatty plugin cannot exhaust page memory.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

const RING_CAPACITY = 2000;

export interface LogRecord {
  readonly at: number;
  readonly level: LogLevel;
  /** Plugin id, or `host` / `host:update` for the system's own output. */
  readonly scope: string;
  readonly message: string;
  /** Extra arguments, stringified at capture so later mutation cannot rewrite history. */
  readonly detail: readonly string[];
}

export const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    // TS types this as `string`, but it genuinely returns undefined for undefined, functions
    // and symbols — so widen to unknown and narrow honestly rather than trusting the signature.
    const json: unknown = JSON.stringify(value);
    return typeof json === 'string' ? json : String(value);
  } catch {
    // Circular structures and getters that throw are both plausible here.
    return String(value);
  }
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function formatRecord(record: LogRecord): string {
  const d = new Date(record.at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const detail = record.detail.length > 0 ? ` ${record.detail.join(' ')}` : '';
  return `${time} ${record.level.toUpperCase().padEnd(5)} [${record.scope}] ${record.message}${detail}`;
}

export class LogSink {
  #records: LogRecord[] = [];
  #minLevel: LogLevel = 'debug';
  readonly #subscribers = new Set<(record: LogRecord) => void>();

  get minLevel(): LogLevel {
    return this.#minLevel;
  }

  set minLevel(level: LogLevel) {
    this.#minLevel = level;
  }

  get records(): readonly LogRecord[] {
    return this.#records;
  }

  write(level: LogLevel, scope: string, message: string, detail: readonly unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#minLevel]) return;

    const record: LogRecord = {
      at: Date.now(),
      level,
      scope,
      message,
      detail: detail.map(stringify),
    };

    this.#records.push(record);
    if (this.#records.length > RING_CAPACITY) this.#records.shift();

    this.#emitToConsole(record, detail);
    for (const subscriber of [...this.#subscribers]) {
      try {
        subscriber(record);
      } catch {
        // A broken log viewer must never break logging itself.
      }
    }
  }

  #emitToConsole(record: LogRecord, detail: readonly unknown[]): void {
    const line = `[vrcnext-plugins:${record.scope}] ${record.message}`;
    switch (record.level) {
      case 'debug':
        globalThis.console.debug(line, ...detail);
        return;
      case 'info':
        globalThis.console.info(line, ...detail);
        return;
      case 'warn':
        globalThis.console.warn(line, ...detail);
        return;
      case 'error':
        globalThis.console.error(line, ...detail);
        return;
    }
  }

  subscribe(listener: (record: LogRecord) => void): () => void {
    this.#subscribers.add(listener);
    return (): void => { this.#subscribers.delete(listener); };
  }

  /** Full log as text, newest last — the same format as the downloaded file. */
  toText(filter?: { readonly level?: LogLevel; readonly scope?: string }): string {
    const min = filter?.level === undefined ? 0 : LEVEL_ORDER[filter.level];
    return this.#records
      .filter((r) => LEVEL_ORDER[r.level] >= min)
      .filter((r) => filter?.scope === undefined || r.scope === filter.scope)
      .map(formatRecord)
      .join('\n');
  }

  /** Distinct scopes seen this session, for the viewer's filter. */
  scopes(): readonly string[] {
    return [...new Set(this.#records.map((r) => r.scope))].sort();
  }

  clear(): void {
    this.#records = [];
  }

  dispose(): void {
    this.#subscribers.clear();
  }
}
