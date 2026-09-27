/**
 * Whether a joiner has been in this exact instance with you before, from VRCNext's own timeline.
 *
 * `getTimelineForUser` returns the ten most recent timeline events involving the player, each with
 * a timestamp and the location it happened in. VRCNext keeps those in SQLite, so they survive
 * VRCNext and VRChat restarts and reach back to when VRCNext was installed. The check is strict on
 * purpose: same world and same instance id, not "met somewhere" and not "an instance like this".
 */

export interface TimelineEntry {
  readonly timestamp: string;
  readonly location: string;
}

export interface Rejoin {
  /** `undefined` when VRCNext did not answer in time. */
  readonly seenHere: boolean | undefined;
  /** When the earlier visit was recorded, as VRCNext's timestamp. */
  readonly lastAt: string | undefined;
}

export const UNKNOWN_REJOIN: Rejoin = { seenHere: undefined, lastAt: undefined };

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Narrows a `timelineForUser` reply for one user. */
export function toTimelineEntries(payload: unknown, userId: string): readonly TimelineEntry[] | undefined {
  const r = rec(payload);
  if (r === undefined || str(r['userId']) !== userId) return undefined;
  const events = Array.isArray(r['events']) ? r['events'] : [];
  return events.flatMap((e) => {
    const entry = rec(e);
    return entry === undefined ? [] : [{ timestamp: str(entry['timestamp']), location: str(entry['location']) }];
  });
}

/** `wrld_…:12345` — the part of a location that identifies the instance, without its modifiers. */
export function instanceKey(location: string): string {
  return location.split('~')[0] ?? '';
}

/**
 * Looks for an earlier event in the same instance. Events from this join are excluded by
 * timestamp: anything at or after `joinedAt` describes this visit, not an earlier one.
 */
export function rejoinIn(
  entries: readonly TimelineEntry[] | undefined,
  location: string,
  joinedAt: number,
): Rejoin {
  if (entries === undefined) return UNKNOWN_REJOIN;
  const key = instanceKey(location);
  if (key === '') return { seenHere: false, lastAt: undefined };
  const earlier = entries
    .filter((e) => instanceKey(e.location) === key)
    .filter((e) => {
      const at = Date.parse(e.timestamp);
      return Number.isFinite(at) && at < joinedAt - 5_000;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const last = earlier[0];
  return { seenHere: last !== undefined, lastAt: last?.timestamp };
}

/** `3 minutes ago`, `2 hours ago`, `5 days ago`. */
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
