import assert from 'node:assert/strict';
import { test } from 'vitest';

import { formatUserEvent, recentUserEvents, userEventLines } from './timeline.js';
import type { VrcTimelineEvent } from './vrchat.js';

const JELLYBEAN = 'wrld_aaaa1111-2222-3333-4444-555566667777:52792~hidden(usr_1)';
const CLUB = 'wrld_aaaa1111-2222-3333-4444-555566667777:11~group(grp_x)~groupAccessType(plus)';

function event(event: Partial<VrcTimelineEvent> & { readonly type: string }): VrcTimelineEvent {
  return { timestamp: '2026-09-28T10:00:00Z', location: '', worldName: '', ...event };
}

test('a moderation record says what was done and that you did it', () => {
  assert.equal(formatUserEvent(event({ type: 'moderation', notifType: 'block', message: 'on' })), 'Blocked by you');
  assert.equal(formatUserEvent(event({ type: 'moderation', notifType: 'block', message: 'off' })), 'Unblocked by you');
  assert.equal(formatUserEvent(event({ type: 'moderation', notifType: 'hideAvatar', message: 'on' })), 'Avatar hidden by you');
});

test('a notification says which kind it was and who sent it', () => {
  assert.equal(
    formatUserEvent(event({ type: 'notification', notifType: 'friendRequest', senderName: 'Nebel' }), { format: 'discord' }),
    'Friend request from **Nebel**',
  );
  assert.equal(formatUserEvent(event({ type: 'notification', notifType: 'group.invite' })), 'Group invite');
  // An unmapped type is still worth showing; VRChat keeps adding them.
  assert.equal(formatUserEvent(event({ type: 'notification', notifType: 'group.something' })), 'Something');
});

test('a visit names the world, the instance and its type', () => {
  assert.equal(
    formatUserEvent(event({ type: 'instance_join', location: JELLYBEAN, worldName: 'Jellybean' }), { format: 'discord' }),
    'Visited `Jellybean` #52792 (Friends+ (legacy))',
  );
});

test('a group instance names the group when the caller can resolve it', () => {
  const options = { format: 'discord' as const, groupName: (id: string) => (id === 'grp_x' ? 'Club Security' : undefined) };
  assert.equal(
    formatUserEvent(event({ type: 'friend_gps', location: CLUB, worldName: 'Jellybean' }), options),
    'Visited `Jellybean` #11 by `Club Security` (Group+)',
  );
  // Without a resolver the line is the same minus the name, never `grp_x`.
  assert.equal(
    formatUserEvent(event({ type: 'friend_gps', location: CLUB, worldName: 'Jellybean' }), { format: 'discord' }),
    'Visited `Jellybean` #11 (Group+)',
  );
});

test('the same thing happening twice becomes one line with a count', () => {
  const visit = (at: string): VrcTimelineEvent => event({ type: 'instance_join', timestamp: at, location: JELLYBEAN, worldName: 'Jellybean' });
  const [entry, ...rest] = recentUserEvents([visit('2026-09-28T09:00:00Z'), visit('2026-09-28T10:00:00Z')]);
  assert.deepEqual(rest, []);
  assert.ok(entry);
  assert.equal(entry.repeats, 2);
  assert.equal(entry.event.timestamp, '2026-09-28T10:00:00Z', 'the newest of the two is kept');
  assert.equal(formatUserEvent(entry, { format: 'discord' }), 'Visited `Jellybean` #52792 (Friends+ (legacy)) ×2');
});

test('visits to different instances stay separate lines', () => {
  const entries = recentUserEvents([
    event({ type: 'instance_join', timestamp: '2026-09-28T09:00:00Z', location: JELLYBEAN, worldName: 'Jellybean' }),
    event({ type: 'instance_join', timestamp: '2026-09-28T10:00:00Z', location: CLUB, worldName: 'Jellybean' }),
  ]);
  assert.equal(entries.length, 2);
});

test('the lines come out newest first, capped, with a time', () => {
  const lines = userEventLines([
    event({ type: 'friend_online', timestamp: '2026-09-28T08:00:00Z' }),
    event({ type: 'moderation', timestamp: '2026-09-28T09:00:00Z', notifType: 'mute', message: 'off' }),
    event({ type: 'friend_avatar', timestamp: '2026-09-28T10:00:00Z' }),
  ], { format: 'discord', limit: 2 });
  assert.deepEqual(lines, ['Changed avatar <t:1790589600:R>', 'Unmuted by you <t:1790586000:R>']);
});

test('a record whose timestamp does not parse is left out, because it cannot be placed', () => {
  assert.deepEqual(userEventLines([event({ type: 'friend_online', timestamp: 'whenever' })]), []);
  assert.deepEqual(userEventLines(undefined), []);
});

/** A profile record as VRCNext files one: the field in `notifType`, the new value in `message`. */
function profile(notifType: string, message: string, timestamp: string): VrcTimelineEvent {
  return { id: `${notifType}-${timestamp}`, type: 'profile', timestamp, location: '', worldName: '', notifType, message };
}

test('profile edits made in one sitting are one line listing what changed', () => {
  const lines = userEventLines([
    profile('bio', 'new bio', '2026-09-28T12:00:00Z'),
    profile('status', 'ask me', '2026-09-28T12:01:00Z'),
    profile('statusdesc', 'at a club', '2026-09-28T12:02:00Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, ['Updated their status text, status and bio']);
});

test('a single edit names the field, and shows the new value when it is worth showing', () => {
  assert.deepEqual(userEventLines([profile('status', 'ask me', '2026-09-28T12:00:00Z')], { time: 'none' }), ['Changed status to "Ask Me"']);
  assert.deepEqual(userEventLines([profile('bio', 'x', '2026-09-28T12:00:00Z')], { time: 'none' }), ['Updated their bio']);
  assert.deepEqual(userEventLines([profile('statusdesc', '', '2026-09-28T12:00:00Z')], { time: 'none' }), ['Cleared their status text']);
});

test('edits hours apart are separate visits to the profile editor', () => {
  const lines = userEventLines([
    profile('bio', 'a', '2026-09-28T08:00:00Z'),
    profile('status', 'busy', '2026-09-28T12:00:00Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, ['Changed status to "Busy"', 'Updated their bio']);
});

test('starting and closing VRChat never merges into an edit', () => {
  const lines = userEventLines([
    profile('bio', 'a', '2026-09-28T12:00:00Z'),
    profile('launch', 'stop', '2026-09-28T12:01:00Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, ['Closed VRChat', 'Updated their bio']);
});
