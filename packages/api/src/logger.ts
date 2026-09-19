/**
 * Plugin logger.
 *
 * Every line is prefixed with the plugin id and mirrored into VRCNext's own activity log, so a
 * user reporting a problem captures plugin output alongside host output in one place.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(message: string, ...detail: readonly unknown[]): void;
  info(message: string, ...detail: readonly unknown[]): void;
  warn(message: string, ...detail: readonly unknown[]): void;
  error(message: string, ...detail: readonly unknown[]): void;
  /** Returns a logger tagged with an extra scope, e.g. `friend-alerts:sync`. */
  scoped(scope: string): Logger;
}
