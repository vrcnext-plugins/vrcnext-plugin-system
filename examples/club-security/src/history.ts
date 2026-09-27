/**
 * Whether a joiner has been met before, from VRCNext's own timeline.
 *
 * VRCNext keeps a `known_users` table and, on every join, records a `first_meet` or `meet_again`
 * timeline event for that player (pushed live as `timelineEvent`, with `meetCount` on repeats).
 * `getTimelineForUser` returns the ten most recent timeline events involving the player, each
 * with a timestamp and the location it happened in. Both survive VRCNext and VRChat restarts and
 * reach back to when VRCNext was installed, which no memory of the plugin's own could.
 *
 * The ten-event window is the honest limit: "how many times in a matching instance" counts only
 * what is in it, and the report says so.
 */

import { instanceMatches, shapeOfLocation, type InstanceFilter } from './filters.js';

export interface MeetEvent {
  readonly type: 'first_meet' | 'meet_again';
  readonly userId: string;
  readonly timestamp: string;
  readonly meetCount: number;
}

export interface TimelineEntry {
  readonly type: string;
  readonly timestamp: string;
  readonly worldName: string;
  readonly location: string;
}

export interface MeetHistory {
  /** `undefined` when VRCNext said nothing in time. */
  readonly metBefore: boolean | undefined;
  /** VRCNext's count of earlier meetings, when it reported one. */
  readonly meetCount: number;
  readonly lastMet: { readonly at: string; readonly worldName: string } | undefined;
  /** Earlier events, within the window VRCNext returned, that happened in a matching instance. */
  readonly matchingBefore: number | undefined;
  /** How many earlier events the window held, so the report can say how far back it looked. */
  readonly windowSize: number;
}

export const UNKNOWN_HISTORY: MeetHistory = {
  metBefore: undefined,
  meetCount: 0,
  lastMet: undefined,
  matchingBefore: undefined,
  windowSize: 0,
};

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Narrows a `timelineEvent` push to the two meeting kinds; anything else is `undefined`. */
export function toMeetEvent(payload: unknown): MeetEvent | undefined {
  const r = rec(payload);
  if (r === undefined) return undefined;
  const type = str(r['type']);
  const userId = str(r['userId']);
  if ((type !== 'first_meet' && type !== 'meet_again') || userId === '') return undefined;
  const count = r['meetCount'];
  return { type, userId, timestamp: str(r['timestamp']), meetCount: typeof count === 'number' ? count : 0 };
}

/** Narrows a `timelineForUser` reply for one user. */
export function toTimelineEntries(payload: unknown, userId: string): readonly TimelineEntry[] | undefined {
  const r = rec(payload);
  if (r === undefined || str(r['userId']) !== userId) return undefined;
  const events = Array.isArray(r['events']) ? r['events'] : [];
  return events.flatMap((e) => {
    const entry = rec(e);
    if (entry === undefined) return [];
    return [{
      type: str(entry['type']),
      timestamp: str(entry['timestamp']),
      worldName: str(entry['worldName']),
      location: str(entry['location']),
    }];
  });
}

/**
 * Combines the live meet event with the user's timeline into one answer.
 *
 * Events from the current join are excluded by timestamp: anything at or after `joinedAt`
 * describes this visit, not an earlier one.
 */
export function summarise(
  meet: MeetEvent | undefined,
  entries: readonly TimelineEntry[] | undefined,
  filter: InstanceFilter,
  joinedAt: number,
): MeetHistory {
  const earlier = (entries ?? []).filter((e) => {
    const at = Date.parse(e.timestamp);
    return Number.isFinite(at) && at < joinedAt - 5_000;
  });
  earlier.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const metBefore = meet !== undefined ? meet.type === 'meet_again' : (entries === undefined ? undefined : earlier.length > 0);
  const last = earlier[0];
  const matching = entries === undefined
    ? undefined
    : earlier.filter((e) => e.location !== '' && instanceMatches(filter, shapeOfLocation(e.location))).length;
  return {
    metBefore,
    meetCount: meet?.meetCount ?? 0,
    lastMet: last === undefined ? undefined : { at: last.timestamp, worldName: last.worldName },
    matchingBefore: matching,
    windowSize: earlier.length,
  };
}
