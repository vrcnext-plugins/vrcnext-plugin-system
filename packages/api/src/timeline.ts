/**
 * VRCNext's timeline records, as sentences.
 *
 * `ctx.vrchat.userTimeline` answers with the app's raw records: a `type` such as `moderation`
 * or `notification`, and whatever fields that type happens to carry. Printing the type is what
 * a column header does, not what a reader wants — "moderation" says nothing, "Blocked by you"
 * says everything. This module is the one place that turns a record into that sentence, so
 * every plugin and the host word it the same way.
 *
 * Two steps, and either is useful on its own:
 *
 * - {@link recentUserEvents} picks the newest records, collapses repeats and caps the count.
 * - {@link formatUserEvent} writes one of them as a line, plain or in Discord's markdown.
 *
 * Everything here is synchronous and pure. A group's *name* is the one thing a record does not
 * carry — it holds `grp_…` — so a caller that has names passes {@link TimelineTextOptions.groupName}.
 */

import { discordCode, discordTimestamp } from './discord-text.js';
import { instanceTypeLabel, parseLocation, type ParsedLocation } from './location.js';
import { newestFirst, timeAgo } from './time.js';
import type { VrcTimelineEvent } from './vrchat.js';

/** Plain text, or Discord markdown with code spans, bold and `<t:…:R>` stamps. */
export type TimelineFormat = 'plain' | 'discord';

export interface TimelineTextOptions {
  readonly format?: TimelineFormat;
  /** Resolves `grp_…` to the group's name. Synchronous: a formatter never waits on the API. */
  readonly groupName?: (groupId: string) => string | undefined;
  /** How many records this line stands for; anything above 1 is stated as `×3`. */
  readonly repeats?: number;
  /** Append the time. `relative` is `(2 hours ago)`; Discord's own stamp when the format is `discord`. */
  readonly time?: 'none' | 'relative';
}

/** One line's worth of timeline: the newest record of its kind, and how many it stands for. */
export interface TimelineEntry {
  readonly event: VrcTimelineEvent;
  /** 1 for a record that happened once, higher when identical records were collapsed. */
  readonly repeats: number;
  /**
   * Every record this entry stands for, newest first.
   *
   * Usually the same record repeated. Profile edits are the exception: VRCNext files one record
   * per field, so changing your bio and your status in one sitting is two records that are not
   * duplicates of each other and are still one thing that happened.
   */
  readonly group?: readonly VrcTimelineEvent[];
}

/**
 * The profile fields VRCNext files a record for, named as a user would name them.
 *
 * `launch` is in the same family but is not an edit — it is the app starting and stopping — so
 * it never merges with the others.
 */
const PROFILE_FIELDS: Readonly<Record<string, string>> = {
  bio: 'bio',
  status: 'status',
  statusdesc: 'status text',
};

/** How long apart two profile edits can be and still be one visit to the profile editor. */
const PROFILE_WINDOW_MS = 10 * 60 * 1000;

/** The types that say a player arrived somewhere without saying anything else about it. */
const VISIT_TYPES: ReadonlySet<string> = new Set(['instance_join', 'friend_gps']);

/** How far apart two arrival records can be and still describe one arrival. */
const ARRIVAL_WINDOW_MS = 5 * 60 * 1000;

/** The types that say a player arrived somewhere *and* that you were there too. */
const MEETING_TYPES: ReadonlySet<string> = new Set(['meet_again', 'first_meet']);

/** `a`, `a and b`, `a, b and c` — an English list, because this is read as a sentence. */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** VRChat's raw status values are lowercase; users see them capitalised. */
function statusLabel(raw: string): string {
  return raw.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** VRCNext's own wording for the moderation actions, which are always something *you* did. */
const MODERATION: Readonly<Record<string, readonly [string, string]>> = {
  block: ['Blocked', 'Unblocked'],
  mute: ['Muted', 'Unmuted'],
  muteChat: ['Chat muted', 'Chat unmuted'],
  hideAvatar: ['Avatar hidden', 'Avatar shown'],
  interactOff: ['Interactions off', 'Interactions on'],
  drone: ['Drone hidden', 'Drone shown'],
};

/** VRChat's notification types, in the words VRCNext shows. */
const NOTIFICATIONS: Readonly<Record<string, string>> = {
  friendRequest: 'Friend request',
  invite: 'World invite',
  requestInvite: 'Invite request',
  inviteResponse: 'Invite response',
  requestInviteResponse: 'Invite request response',
  votetokick: 'Vote to kick',
  boop: 'Boop',
  message: 'Message',
  halted: 'Instance closed',
  'group.announcement': 'Group announcement',
  'instance.announcement': 'Instance announcement',
  'group.invite': 'Group invite',
  'group.joinRequest': 'Group join request',
  'group.informationRequest': 'Group info request',
  'group.transfer': 'Group transfer',
  'group.informative': 'Group info',
  'group.post': 'Group post',
  'group.event.created': 'Group event created',
  'group.event.starting': 'Group event starting',
  'avatarreview.success': 'Avatar approved',
  'avatarreview.failure': 'Avatar rejected',
  'badge.earned': 'Badge earned',
  'economy.alert': 'Economy alert',
  'economy.received.gift': 'Gift received',
  'event.announcement': 'Event announcement',
  'invite.instance.contentGated': 'Content gated invite',
  'moderation.contentrestriction': 'Content restriction',
  'moderation.notice': 'Moderation notice',
  'moderation.report.closed': 'Report closed',
  'moderation.warning.group': 'Group warning',
  'promo.redeem': 'Promo redeemed',
  'vrcplus.gift': 'VRC+ gift',
};

/** `friend_statusdesc` → `status`, so an unmapped type still reads as words. */
function humanise(type: string): string {
  const words = type.replace(/^(friend|group|moderation)[_.]/, '').replace(/[_.]/g, ' ').trim();
  if (words === '') return 'Something happened';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A field as text, or `''` for anything that is not a string.
 *
 * Records reach this formatter from VRCNext's payloads and from VRCNext's own database, and both
 * can carry a null or a number where the type says string — a SQLite `NULL` column is the usual
 * one. Without this, one such record threw out of `userEventLines` and took the whole report with
 * it: the plugin's Discord *and* VR channels both failed on a single malformed row. A field it
 * cannot read is dropped, the same way an unreadable timestamp drops its stamp.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function quote(value: unknown, format: TimelineFormat): string {
  const name = text(value);
  return format === 'discord' ? discordCode(name) : `"${name}"`;
}

/**
 * Where it happened: `` `Jellybean #52792` by `Club Security` (Group+) ``.
 *
 * The world and the instance number are one quoted span, because together they are the name of
 * the place: `` `Jellybean` #52792 `` reads as a world with a number stuck to it, while
 * `` `Jellybean #52792` `` reads as the instance a moderator would recognise. Each part is
 * dropped when the record does not carry it, so a location VRCNext only knows the world of
 * still reads as a world rather than as punctuation.
 */
function place(event: VrcTimelineEvent, options: TimelineTextOptions): string {
  const format = options.format ?? 'plain';
  const parsed = parseLocation(text(event.location));
  const named = text(event.worldName) !== '' ? text(event.worldName) : parsed.worldId;
  const parts: string[] = [];
  if (named !== '') {
    parts.push(quote(parsed.instanceId === '' ? named : `${named} #${parsed.instanceId}`, format));
  } else if (parsed.instanceId !== '') parts.push(`#${parsed.instanceId}`);
  const group = parsed.groupId === '' ? '' : text(options.groupName?.(parsed.groupId));
  if (group !== '') parts.push(`by ${quote(group, format)}`);
  if (parsed.instanceType !== '') parts.push(`(${instanceTypeLabel(parsed.instanceType)})`);
  return parts.join(' ');
}

/** `X`, bold in Discord, for a person's name. `''` when there is no name to state. */
function who(name: string | undefined, format: TimelineFormat): string {
  if (name === undefined || name === '') return '';
  return format === 'discord' ? `**${name}**` : name;
}

function moderationText(event: VrcTimelineEvent): string {
  const pair = MODERATION[event.notifType ?? ''];
  // `message` is VRCNext's on/off flag for the action, not a sentence.
  const undone = (event.message ?? 'on') === 'off';
  if (pair === undefined) return `${humanise(event.notifType ?? 'moderation')} by you`;
  return `${undone ? pair[1] : pair[0]} by you`;
}

function notificationText(event: VrcTimelineEvent, format: TimelineFormat): string {
  const type = event.notifType ?? '';
  const label = NOTIFICATIONS[type] ?? (type === '' ? 'Notification' : humanise(type));
  const from = who(event.senderName, format);
  const title = event.notifTitle ?? '';
  if (from !== '') return `${label} from ${from}`;
  if (title !== '') return `${label}: ${title}`;
  return label;
}

/** The sentence itself, without the count and without the time. */
/**
 * What was changed, rather than that something was.
 *
 * One record names its field and, where the new value is short and means something on its own,
 * shows it. Several records from one sitting are listed instead: "Updated their bio, status and
 * status text" says in one line what three lines of "Updated their profile" did not say at all.
 */
function profileText(event: VrcTimelineEvent, group: readonly VrcTimelineEvent[], format: TimelineFormat): string {
  const fields = [...new Set(group.map((record) => PROFILE_FIELDS[record.notifType ?? '']).filter((name) => name !== undefined))];
  if (fields.length > 1) return `Updated their ${listOf(fields)}`;

  const value = text(event.message);
  if (event.notifType === 'status') {
    return value === '' ? 'Changed their status' : `Changed status to ${quote(statusLabel(value), format)}`;
  }
  if (event.notifType === 'statusdesc') {
    return value === '' ? 'Cleared their status text' : `Changed their status text to ${quote(value, format)}`;
  }
  if (event.notifType === 'bio') return 'Updated their bio';
  return 'Updated their profile';
}

function sentence(event: VrcTimelineEvent, options: TimelineTextOptions, group: readonly VrcTimelineEvent[] = [event]): string {
  const format = options.format ?? 'plain';
  const where = place(event, options);
  const at = where === '' ? '' : ` ${where}`;
  const inAt = where === '' ? '' : ` in ${where}`;
  switch (event.type) {
    case 'instance_join':
    case 'friend_gps':
      return where === '' ? 'Moved instance' : `Visited${at}`;
    case 'meet_again':
      return `Met again${inAt}`;
    case 'first_meet':
      return `Met for the first time${inAt}`;
    case 'friend_online':
      return 'Came online';
    case 'friend_offline':
      return 'Went offline';
    case 'friend_avatar':
    case 'avatar_switch':
      return 'Changed avatar';
    case 'friend_bio':
      return 'Changed their bio';
    case 'friend_status':
    case 'friend_statusdesc':
      return 'Changed their status';
    case 'friend_added':
      return 'Added as a friend';
    case 'friend_removed':
      return 'Removed as a friend';
    case 'moderation':
      return moderationText(event);
    case 'notification':
      return notificationText(event, format);
    case 'photo':
      return `Took a photo${inAt}`;
    case 'video_url':
      return `Played a video${inAt}`;
    case 'profile':
      // VRCNext files the app's own start and stop under `profile`.
      if (event.notifType === 'launch') return event.message === 'start' ? 'Started VRChat' : 'Closed VRChat';
      return profileText(event, group, format);
    default:
      return humanise(event.type);
  }
}

/**
 * One record as a line: `` Visited `Jellybean #52792` (Friends+) ×2 <t:…:R> ``.
 *
 * Takes either a raw record or a {@link TimelineEntry} from {@link recentUserEvents}, whose
 * `repeats` then fills in {@link TimelineTextOptions.repeats}.
 */
export function formatUserEvent(
  event: VrcTimelineEvent | TimelineEntry,
  options: TimelineTextOptions = {},
): string {
  const entry: TimelineEntry = 'event' in event ? event : { event, repeats: 1 };
  const repeats = options.repeats ?? entry.repeats;
  const format = options.format ?? 'plain';
  const parts = [sentence(entry.event, options, entry.group ?? [entry.event])];
  if (repeats > 1) parts.push(`×${String(repeats)}`);
  if ((options.time ?? 'none') === 'relative') {
    const when = format === 'discord'
      ? discordTimestamp(entry.event.timestamp)
      : relative(entry.event.timestamp);
    if (when !== '') parts.push(when);
  }
  return parts.join(' ');
}

/** `(2 hours ago)`, or `''` for an instant that does not parse. Discord gets its own stamp. */
function relative(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '';
  return `(${timeAgo(ms)})`;
}

/**
 * What identifies "the same thing happening again": the type, plus whichever detail makes two
 * records of that type distinguishable. Two visits to one instance collapse; two visits to
 * different instances do not.
 *
 * Arrivals are keyed by the instance alone. VRCNext files a separate record every time someone
 * walks into a place — and files `instance_join` *and* `meet_again` for the same arrival — so
 * keying them by type as well spent a five-line log saying "this instance" five ways. One line
 * per instance with a count is the whole of that news. `first_meet` is deliberately not in
 * {@link ARRIVALS}: it happens once per person and is worth its own line even in a place they
 * have since returned to a hundred times.
 */
function key(event: VrcTimelineEvent): string {
  const location = parseLocation(event.location).key || event.location;
  if (ARRIVALS.has(event.type) && location !== '') return `arrival|${location}`;
  return [event.type, event.notifType ?? '', location, event.worldName, event.message ?? ''].join('|');
}

/** The types that collapse to one line per instance: going somewhere, and meeting there again. */
const ARRIVALS: ReadonlySet<string> = new Set([...VISIT_TYPES, 'meet_again']);

/**
 * Which of two records of the same arrival to word the line as.
 *
 * "Met again in X" is everything "Visited X" says and more, so a meeting outranks a visit even
 * when the visit is the newer record. The timestamp still comes from the newest, which is when
 * the place last saw them.
 */
function outranks(candidate: VrcTimelineEvent, current: VrcTimelineEvent): boolean {
  return MEETING_TYPES.has(candidate.type) && !MEETING_TYPES.has(current.type);
}

/**
 * Every record, deduplicated, newest first — the whole history as lines would show it.
 *
 * VRCNext files one record per occurrence, so a player who walked in and out of an instance
 * three times fills the whole window with the same line. Records that {@link key} calls the
 * same collapse into one entry with a `repeats` count, which is what makes a short log say
 * something: five lines of five different things rather than five lines of one.
 *
 * Records whose timestamp does not parse are left out, because they cannot be placed in order.
 */
function collapse(events: readonly VrcTimelineEvent[] | undefined): readonly TimelineEntry[] {
  interface Collapsing { event: VrcTimelineEvent; repeats: number; countedAt: number }
  const seen = new Map<string, Collapsing>();
  const order: string[] = [];
  for (const event of newestFirst(events)) {
    const id = key(event);
    const at = Date.parse(event.timestamp);
    const existing = seen.get(id);
    if (existing === undefined) {
      seen.set(id, { event, repeats: 1, countedAt: at });
      order.push(id);
      continue;
    }
    // One arrival, two records: VRCNext files `instance_join` because they went somewhere and
    // `meet_again` because you were there when they did. Counting both would say they came
    // twice. Anything beyond the window is a separate arrival and does count.
    const sameArrival = ARRIVALS.has(event.type) && existing.countedAt - at <= ARRIVAL_WINDOW_MS;
    if (!sameArrival) {
      existing.repeats += 1;
      existing.countedAt = at;
    }
    if (outranks(event, existing.event)) {
      // The better sentence, kept at the newest record's timestamp: the entry says when the
      // place last saw them, and says it as the meeting rather than as the bare arrival.
      existing.event = { ...event, timestamp: existing.event.timestamp };
    }
  }
  const collapsed = order
    .map((id) => seen.get(id))
    .filter((entry): entry is Collapsing => entry !== undefined)
    .map((entry) => ({ event: entry.event, repeats: entry.repeats, group: [entry.event] }));
  return mergeProfileEdits(collapsed);
}

/**
 * The newest records, deduplicated, newest first.
 *
 * {@link collapse} capped at `limit`. Use {@link userEventRows} where the oldest record should
 * be kept too.
 */
export function recentUserEvents(
  events: readonly VrcTimelineEvent[] | undefined,
  limit = 5,
): readonly TimelineEntry[] {
  return collapse(events).slice(0, Math.max(limit, 0));
}

/** Stands for the entries a capped log left out, between the newest and the oldest. */
export const TIMELINE_GAP = 'gap';

/** A line's worth of log: an entry, or the gap that stands for what was left out. */
export type TimelineRow = TimelineEntry | typeof TIMELINE_GAP;

/** How many rows a log shows when the caller does not say. */
const DEFAULT_LIMIT = 5;

export interface TimelineRowOptions {
  /** How many rows, the gap and the oldest included. */
  readonly limit?: number;
  /**
   * Keep the oldest record as the last row, with a gap above it.
   *
   * The oldest thing VRCNext knows about someone is usually the day you met them, and it is the
   * one record a window of the five newest can never show. Pinning it turns the log from "what
   * they did in the last hour" into "what they did, and since when".
   */
  readonly oldest?: boolean;

  /**
   * Draw the gap even when this list dropped nothing.
   *
   * The gap says "there is history between these two rows that you are not seeing", and by
   * default that is inferred from this call having truncated. It is not the only way to know
   * it: a caller that appended an oldest record from somewhere deeper — VRCNext's database,
   * where the page only answers with ten records — has a hole between it and the rest by
   * construction, and no amount of counting *these* rows can show that. Without this, eight
   * entries and a five-year-old last row render as one unbroken list.
   */
  readonly knownGap?: boolean;
}

/**
 * The rows a log field shows: newest first, optionally ending at the oldest record.
 *
 * Returned rather than formatted so a caller can look at the entries first — resolving the
 * group names the lines will mention, for one — and be certain it looked at exactly the rows
 * that get printed.
 */
export function userEventRows(
  events: readonly VrcTimelineEvent[] | undefined,
  options: TimelineRowOptions = {},
): readonly TimelineRow[] {
  const limit = Math.max(options.limit ?? DEFAULT_LIMIT, 0);
  const all = collapse(events);
  if (options.oldest !== true || limit < 3) return all.slice(0, limit);
  // Something is missing when this call truncated, or when the caller knows it is.
  const hole = all.length > limit || options.knownGap === true;
  if (!hole) return all.slice(0, limit);
  const oldest = all[all.length - 1];
  if (oldest === undefined) return all.slice(0, limit);
  // Everything that fits above the gap and the pinned row, and never the pinned row twice.
  const head = all.slice(0, Math.min(limit - 2, all.length - 1));
  return [...head, TIMELINE_GAP, oldest];
}

/**
 * Every distinct instance these records mention, newest first.
 *
 * One entry per instance however many times it appears, which is what counting "times they have
 * been somewhere like this" means: a player who spent a weekend in one room was there once as
 * far as a club's history is concerned.
 */
export function instancesSeen(events: readonly VrcTimelineEvent[] | undefined): readonly ParsedLocation[] {
  const seen = new Map<string, ParsedLocation>();
  for (const event of newestFirst(events)) {
    const parsed = parseLocation(event.location);
    if (parsed.key !== '' && !seen.has(parsed.key)) seen.set(parsed.key, parsed);
  }
  return [...seen.values()];
}

/** `1` → `1st`, `12` → `12th`, `23` → `23rd`. English, because the sentences here are. */
export function ordinal(count: number): string {
  const n = Math.trunc(count);
  const tens = Math.abs(n) % 100;
  const suffix = tens >= 11 && tens <= 13
    ? 'th'
    : (['th', 'st', 'nd', 'rd'][Math.abs(n) % 10] ?? 'th');
  return `${String(n)}${suffix}`;
}

/** Whether a record is one field of a profile edit, as opposed to the app starting or stopping. */
function isProfileEdit(event: VrcTimelineEvent): boolean {
  return event.type === 'profile' && PROFILE_FIELDS[event.notifType ?? ''] !== undefined;
}

/**
 * Profile edits made in one sitting become one entry.
 *
 * They are not duplicates — a bio change and a status change are different records — so the
 * dedup above keeps both, and the log then spends two of its five lines saying "Updated their
 * profile" twice. Anything from the same {@link PROFILE_WINDOW_MS} window merges into the
 * newest of them, which is the one the timestamp should read from.
 */
function mergeProfileEdits(entries: readonly { event: VrcTimelineEvent; repeats: number; group: VrcTimelineEvent[] }[]): TimelineEntry[] {
  const merged: { event: VrcTimelineEvent; repeats: number; group: VrcTimelineEvent[] }[] = [];
  for (const entry of entries) {
    const previous = merged[merged.length - 1];
    const joinable = previous !== undefined
      && isProfileEdit(entry.event)
      && isProfileEdit(previous.event)
      && Date.parse(previous.event.timestamp) - Date.parse(entry.event.timestamp) <= PROFILE_WINDOW_MS;
    if (joinable) {
      previous.group.push(...entry.group);
      previous.repeats += entry.repeats;
      continue;
    }
    merged.push(entry);
  }
  // A merged entry counts fields, not occurrences: "×3" beside a list of three fields would be
  // saying the same three twice.
  return merged.map((entry) => ({
    event: entry.event,
    repeats: entry.group.length > 1 && isProfileEdit(entry.event) ? 1 : entry.repeats,
    group: entry.group,
  }));
}

/**
 * As many of these lines as fit in `budget` characters, joined by newlines.
 *
 * Discord caps an embed field at {@link EMBED_LIMITS.fieldValue} characters and silently cuts
 * what is over, which ends a log mid-word. A line count cannot prevent that: one arrival at
 * `YTS 2.1 - YouTube Search, Subtitles, Quest #27377` is three times the length of "Came
 * online", so any count safe for the worst case wastes most of the field in the normal one. So
 * the caller asks for more lines than it expects to fit and this drops what does not.
 *
 * What goes first is what a reader loses least by: the lines just above the gap, which are the
 * middle of the history. The newest line and the pinned oldest one are the two the field exists
 * for, so they go last — and if even those two do not fit, the oldest goes and the newest stays.
 */
export function fitLines(lines: readonly string[], budget: number, options: { readonly gap?: string } = {}): readonly string[] {
  const length = (list: readonly string[]): number => list.reduce((total, line) => total + line.length + 1, -1);
  const kept = [...lines];
  const gapAt = (): number => (options.gap === undefined ? -1 : kept.indexOf(options.gap));
  while (kept.length > 1 && length(kept) > budget) {
    const gap = gapAt();
    // Above the gap while there is a middle to lose; from the end once the gap is the middle.
    const drop = gap > 1 ? gap - 1 : kept.length - 1;
    kept.splice(drop, 1);
    // A gap left with nothing between it and the oldest row stands for nothing.
    if (gap === 1 && kept.length === 2) kept.splice(1, 1);
  }
  return length(kept) > budget ? [] : kept;
}

/**
 * {@link userEventRows} and {@link formatUserEvent} together: the lines a log field shows.
 *
 * The gap prints as `...`, which says "and more before this" in the one character a Discord
 * field can spare. Returns an empty array when there is nothing to say, so a caller can drop
 * the field rather than print an empty box.
 */
export function userEventLines(
  events: readonly VrcTimelineEvent[] | undefined,
  options: TimelineTextOptions & TimelineRowOptions = {},
): readonly string[] {
  return userEventRows(events, options)
    .map((row) => (row === TIMELINE_GAP ? '...' : formatUserEvent(row, { time: 'relative', ...options })));
}
