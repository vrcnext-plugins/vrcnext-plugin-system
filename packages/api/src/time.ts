/**
 * Small, pure time helpers plugins keep needing. They live here so no plugin has to carry its
 * own copy; add to this file rather than to a plugin.
 */

/** `just now`, `3 minutes ago`, `2 hours ago`, `5 days ago`. Coarse on purpose. */
export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'} ago`;
}
