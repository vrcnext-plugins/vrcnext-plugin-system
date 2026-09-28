/**
 * Small, pure time helpers plugins keep needing. They live here so no plugin has to carry its
 * own copy; add to this file rather than to a plugin.
 */

/** An instant, however the caller happens to hold it. */
export type TimeInput = string | number | Date;

function millis(value: TimeInput): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : Date.parse(value);
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * `just now`, `3 minutes ago`, `2 hours ago`, `5 days ago`, `3 months ago`, `2 years ago`.
 *
 * Coarse on purpose: one unit, the largest that fits. Months are 30 days and years are 365,
 * which is what a profile line wants and what nobody counts.
 */
export function timeAgo(at: TimeInput, now = Date.now()): string {
  const ms = now - millis(at);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, 'day');
  if (days < 365) return plural(Math.floor(days / 30), 'month');
  return plural(Math.floor(days / 365), 'year');
}

/**
 * `45 minutes`, `3 hours`, `5 days`, `4 months`, `2 years` — the same coarse unit
 * {@link timeAgo} picks, without the "ago", for a length of time rather than a point in it.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.floor(ms / 60_000);
  const say = (count: number, unit: string): string => `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
  if (minutes < 60) return say(Math.max(minutes, 1), 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return say(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return say(days, 'day');
  if (days < 365) return say(Math.floor(days / 30), 'month');
  return say(Math.floor(days / 365), 'year');
}

/** Anything with a timestamp: a timeline event, a log line, a report. */
export interface Timestamped {
  readonly timestamp: TimeInput;
}

/**
 * The same items, newest first, without the ones whose timestamp does not parse.
 *
 * VRCNext's timeline arrives in no guaranteed order and "the newest event" is the question
 * almost every caller has, so ordering it belongs here rather than in each plugin. A record
 * with an unreadable timestamp cannot be placed in the order at all — sorting it would put it
 * somewhere arbitrary — so it is dropped rather than silently ranked as 1970.
 */
export function newestFirst<T extends Timestamped>(items: readonly T[] | undefined): readonly T[] {
  if (items === undefined) return [];
  return items
    .map((item) => ({ item, at: millis(item.timestamp) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => b.at - a.at)
    .map((entry) => entry.item);
}
