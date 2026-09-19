/**
 * Logger that mirrors into VRCNext's own activity log.
 *
 * VRCNext appends every `log` event it *sends* to the page into `Logs/`, but the page has no
 * way to write there. Mirroring is therefore best-effort console output plus an in-memory ring
 * the plugin manager UI can show, which is enough for a user to copy when reporting a bug.
 */

import { LOG_LEVELS, type Logger, type LogLevel } from '@vrcnext/plugin-api';

const RING_CAPACITY = 500;

export interface LogRecord {
  readonly at: number;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class LogSink {
  readonly #records: LogRecord[] = [];
  #minLevel: LogLevel = 'info';

  set minLevel(level: LogLevel) {
    this.#minLevel = level;
  }

  get records(): readonly LogRecord[] {
    return this.#records;
  }

  write(level: LogLevel, scope: string, message: string, detail: readonly unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#minLevel]) return;

    this.#records.push({ at: Date.now(), level, scope, message });
    if (this.#records.length > RING_CAPACITY) this.#records.shift();

    const line = `[vrcnext-plugins:${scope}] ${message}`;
    switch (level) {
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
}

export function createLogger(sink: LogSink, scope: string): Logger {
  const logger: Partial<Logger> = {
    scoped: (child: string): Logger => createLogger(sink, `${scope}:${child}`),
  };
  for (const level of LOG_LEVELS) {
    logger[level] = (message: string, ...detail: readonly unknown[]): void => {
      sink.write(level, scope, message, detail);
    };
  }
  return logger as Logger;
}
