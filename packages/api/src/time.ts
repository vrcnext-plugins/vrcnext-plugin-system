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
