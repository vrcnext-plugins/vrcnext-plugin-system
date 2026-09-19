/**
 * Builds the per-plugin {@link Logger} facade over the shared {@link LogSink}.
 */

import { LOG_LEVELS, type Logger } from '@vrcnext/plugin-api';

import type { LogSink } from './log-sink.js';

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
