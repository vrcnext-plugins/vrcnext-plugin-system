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
import { instanceTypeLabel, parseLocation } from './location.js';
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

function quote(text: string, format: TimelineFormat): string {
  return format === 'discord' ? discordCode(text) : `"${text}"`;
}

/**
 * Where it happened: `` `Jellybean` #52792 by `Club Security` (Group+) ``.
 *
 * Each part is dropped when the record does not carry it, so a location VRCNext only knows the
 * world of still reads as a world rather than as punctuation.
 */
function place(event: VrcTimelineEvent, options: TimelineTextOptions): string {
  const format = options.format ?? 'plain';
  const parsed = parseLocation(event.location);
  const world = event.worldName;
  const parts: string[] = [];
  if (world !== '') parts.push(quote(world, format));
  else if (parsed.worldId !== '') parts.push(quote(parsed.worldId, format));
  if (parsed.instanceId !== '') parts.push(`#${parsed.instanceId}`);
  const group = parsed.groupId === '' ? undefined : options.groupName?.(parsed.groupId);
  if (group !== undefined && group !== '') parts.push(`by ${quote(group, format)}`);
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
function sentence(event: VrcTimelineEvent, options: TimelineTextOptions): string {
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
      return 'Updated their profile';
    default:
      return humanise(event.type);
  }
}

/**
 * One record as a line: `` Visited `Jellybean` #52792 (Friends+ (legacy)) ×2 <t:…:R> ``.
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
  const parts = [sentence(entry.event, options)];
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
 */
function key(event: VrcTimelineEvent): string {
  const location = parseLocation(event.location).key || event.location;
  return [event.type, event.notifType ?? '', location, event.worldName, event.message ?? ''].join('|');
}

/**
 * The newest records, deduplicated, newest first.
 *
 * VRCNext files one record per occurrence, so a player who walked in and out of an instance
 * three times fills the whole window with the same line. Identical records collapse into the
 * newest one with a `repeats` count, which is what makes a short log say something: five lines
 * of five different things rather than five lines of one.
 *
 * Records whose timestamp does not parse are left out, because they cannot be placed in order.
 */
export function recentUserEvents(
  events: readonly VrcTimelineEvent[] | undefined,
  limit = 5,
): readonly TimelineEntry[] {
  const seen = new Map<string, { event: VrcTimelineEvent; repeats: number }>();
  const order: string[] = [];
  for (const event of newestFirst(events)) {
    const id = key(event);
    const existing = seen.get(id);
    if (existing === undefined) {
      seen.set(id, { event, repeats: 1 });
      order.push(id);
    } else {
      existing.repeats += 1;
    }
  }
  return order
    .slice(0, Math.max(limit, 0))
    .map((id) => seen.get(id))
    .filter((entry): entry is { event: VrcTimelineEvent; repeats: number } => entry !== undefined)
    .map((entry) => ({ event: entry.event, repeats: entry.repeats }));
}

/**
 * {@link recentUserEvents} and {@link formatUserEvent} together: the lines a log field shows.
 *
 * Returns an empty array when there is nothing to say, so a caller can drop the field rather
 * than print an empty box.
 */
export function userEventLines(
  events: readonly VrcTimelineEvent[] | undefined,
  options: TimelineTextOptions & { readonly limit?: number } = {},
): readonly string[] {
  return recentUserEvents(events, options.limit ?? 5)
    .map((entry) => formatUserEvent(entry, { time: 'relative', ...options }));
}
