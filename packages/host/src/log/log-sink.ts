/**
 * Central log sink.
 *
 * > [!IMPORTANT]
 * > **This cannot write to VRCNext's own `Logs/` file.** VRCNext appends to that file inside
 * > `AppShell.SendToJS` — the C#→page direction — and exposes no page→C# action that logs
 * > arbitrary text. The page has no filesystem access either. So "follow what plugins are
 * > doing without reading the browser console" is served three other ways instead:
 * >
 * > 1. A live **Logs panel** in the Plugins tab.
 * > 2. **Persistence to IndexedDB**, so logs survive a VRCNext restart.
 * > 3. **Download as a `.log` file**, which is a real file on disk.
 *
 * Records are kept in a ring buffer so a chatty plugin cannot exhaust page memory.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

import { STORES, type IdbStore } from '../storage/idb-store.js';

const RING_CAPACITY = 2000;
const PERSIST_DEBOUNCE_MS = 2000;
const PERSIST_KEY = 'host-log';

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
  #storage: IdbStore | undefined;
  #persistTimer: ReturnType<typeof setTimeout> | undefined;
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

  /** Attaches persistence and restores the previous session's tail. */
  async attachStorage(storage: IdbStore): Promise<void> {
    this.#storage = storage;
    const persisted = await storage.get<LogRecord[]>(STORES.settings, PERSIST_KEY);
    if (Array.isArray(persisted) && this.#records.length === 0) {
      this.#records = persisted.slice(-RING_CAPACITY);
    }
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
    this.#schedulePersist();
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

  #schedulePersist(): void {
    if (this.#storage === undefined || this.#persistTimer !== undefined) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      void this.#storage?.set(STORES.settings, PERSIST_KEY, this.#records).catch(() => {
        // Losing a persisted tail is not worth surfacing to the user.
      });
    }, PERSIST_DEBOUNCE_MS);
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
    void this.#storage?.set(STORES.settings, PERSIST_KEY, []).catch(() => undefined);
  }

  dispose(): void {
    if (this.#persistTimer !== undefined) clearTimeout(this.#persistTimer);
    this.#persistTimer = undefined;
    this.#subscribers.clear();
  }
}
