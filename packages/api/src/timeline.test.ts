import assert from 'node:assert/strict';
import { test } from 'vitest';

import { TIMELINE_GAP, fitLines, formatUserEvent, instancesSeen, ordinal, recentUserEvents, userEventLines, userEventRows } from './timeline.js';
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
    'Visited `Jellybean #52792` (Friends+)',
  );
});

test('a group instance names the group when the caller can resolve it', () => {
  const options = { format: 'discord' as const, groupName: (id: string) => (id === 'grp_x' ? 'Club Security' : undefined) };
  assert.equal(
    formatUserEvent(event({ type: 'friend_gps', location: CLUB, worldName: 'Jellybean' }), options),
    'Visited `Jellybean #11` by `Club Security` (Group+)',
  );
  // Without a resolver the line is the same minus the name, never `grp_x`.
  assert.equal(
    formatUserEvent(event({ type: 'friend_gps', location: CLUB, worldName: 'Jellybean' }), { format: 'discord' }),
    'Visited `Jellybean #11` (Group+)',
  );
});

test('the same thing happening twice becomes one line with a count', () => {
  const visit = (at: string): VrcTimelineEvent => event({ type: 'instance_join', timestamp: at, location: JELLYBEAN, worldName: 'Jellybean' });
  const [entry, ...rest] = recentUserEvents([visit('2026-09-28T09:00:00Z'), visit('2026-09-28T10:00:00Z')]);
  assert.deepEqual(rest, []);
  assert.ok(entry);
  assert.equal(entry.repeats, 2);
  assert.equal(entry.event.timestamp, '2026-09-28T10:00:00Z', 'the newest of the two is kept');
  assert.equal(formatUserEvent(entry, { format: 'discord' }), 'Visited `Jellybean #52792` (Friends+) ×2');
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

/** A record of `type` at one place and time, as VRCNext files it. */
function at(type: string, location: string, worldName: string, timestamp: string): VrcTimelineEvent {
  return { id: `${type}-${timestamp}`, type, timestamp, location, worldName };
}

const JELLY = 'wrld_11111111-1111-1111-1111-111111111111:52792~hidden(usr_1)';

test('a meeting and the visit it explains are one arrival, and the meeting is the one kept', () => {
  const lines = userEventLines([
    at('instance_join', JELLY, 'Jellybean', '2026-09-28T12:00:00Z'),
    at('meet_again', JELLY, 'Jellybean', '2026-09-28T12:00:01Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, ['Met again in "Jellybean #52792" (Friends+)']);
});

test('a visit somewhere you did not meet them stays', () => {
  const other = 'wrld_22222222-2222-2222-2222-222222222222:11111~public';
  const lines = userEventLines([
    at('instance_join', other, 'Worlds Apart', '2026-09-28T11:00:00Z'),
    at('meet_again', JELLY, 'Jellybean', '2026-09-28T12:00:00Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, [
    'Met again in "Jellybean #52792" (Friends+)',
    'Visited "Worlds Apart #11111" (Public)',
  ]);
});

test('every arrival at one instance is one counted line, however far apart', () => {
  const lines = userEventLines([
    at('instance_join', JELLY, 'Jellybean', '2026-09-28T06:00:00Z'),
    at('instance_join', JELLY, 'Jellybean', '2026-09-28T11:00:00Z'),
    at('meet_again', JELLY, 'Jellybean', '2026-09-28T12:00:00Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, ['Met again in "Jellybean #52792" (Friends+) ×3'],
    'one place, one line, counting the three arrivals and worded as the meeting');
});

test('meeting someone for the first time keeps its own line in a place they return to', () => {
  const lines = userEventLines([
    at('first_meet', JELLY, 'Jellybean', '2026-01-01T12:00:00Z'),
    at('meet_again', JELLY, 'Jellybean', '2026-09-28T12:00:00Z'),
  ], { time: 'none' });
  assert.deepEqual(lines, [
    'Met again in "Jellybean #52792" (Friends+)',
    'Met for the first time in "Jellybean #52792" (Friends+)',
  ]);
});

test('the oldest record is pinned last, with a gap for what is between', () => {
  const rows = userEventRows([
    event({ type: 'friend_online', timestamp: '2026-09-21T10:00:00Z' }),
    event({ type: 'friend_offline', timestamp: '2026-09-22T10:00:00Z' }),
  ], { oldest: true });
  assert.equal(rows.length, 2, 'nothing was left out, so no row is spent on a gap');

  const lines = userEventLines([
    at('first_meet', JELLY, 'Jellybean', '2026-01-01T12:00:00Z'),
    at('instance_join', 'wrld_2222:1~public', 'A', '2026-02-01T12:00:00Z'),
    at('instance_join', 'wrld_3333:2~public', 'B', '2026-03-01T12:00:00Z'),
    at('instance_join', 'wrld_4444:3~public', 'C', '2026-04-01T12:00:00Z'),
    at('instance_join', 'wrld_5555:4~public', 'D', '2026-05-01T12:00:00Z'),
    at('instance_join', 'wrld_6666:5~public', 'E', '2026-06-01T12:00:00Z'),
  ], { time: 'none', limit: 4, oldest: true });
  assert.deepEqual(lines, [
    'Visited "E #5" (Public)',
    'Visited "D #4" (Public)',
    '...',
    'Met for the first time in "Jellybean #52792" (Friends+)',
  ]);
});

test('instancesSeen names each instance once, and ordinal counts in English', () => {
  const places = instancesSeen([
    at('instance_join', JELLY, 'Jellybean', '2026-09-28T06:00:00Z'),
    at('meet_again', JELLY, 'Jellybean', '2026-09-28T12:00:00Z'),
    at('instance_join', CLUB, 'Jellybean', '2026-09-28T13:00:00Z'),
    at('friend_online', '', '', '2026-09-28T14:00:00Z'),
  ]);
  assert.deepEqual(places.map((p) => p.instanceId), ['11', '52792'], 'newest first, no duplicates, nowhere skipped');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 23, 112].map(ordinal), [
    '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '23rd', '112th',
  ]);
});

test('the gap row is a row, not a formatted entry', () => {
  const rows = userEventRows([
    at('instance_join', 'wrld_2222:1~public', 'A', '2026-02-01T12:00:00Z'),
    at('instance_join', 'wrld_3333:2~public', 'B', '2026-03-01T12:00:00Z'),
    at('instance_join', 'wrld_4444:3~public', 'C', '2026-04-01T12:00:00Z'),
    at('instance_join', 'wrld_5555:4~public', 'D', '2026-05-01T12:00:00Z'),
  ], { limit: 3, oldest: true });
  assert.equal(rows[1], TIMELINE_GAP);
  assert.equal(rows.length, 3);
});

test('fitLines drops the middle first, keeps the newest, and gives up the oldest last', () => {
  const line = (text: string): string => `- ${text.padEnd(28, '.')}`;
  const lines = [line('newest'), line('second'), line('third'), '- ...', line('oldest')];
  assert.equal(lines.join('\n').length, 129);

  assert.deepEqual(fitLines(lines, 129, { gap: '- ...' }), lines, 'exactly the budget is within it');
  assert.deepEqual(
    fitLines(lines, 100, { gap: '- ...' }),
    [line('newest'), line('second'), '- ...', line('oldest')],
    'the third line is the middle of the history, so it goes first',
  );
  assert.deepEqual(
    fitLines(lines, 70, { gap: '- ...' }),
    [line('newest'), '- ...', line('oldest')],
    'the newest and the oldest are what the field exists for',
  );
  assert.deepEqual(
    fitLines(lines, 40, { gap: '- ...' }),
    [line('newest')],
    'the gap stands for nothing once the oldest is gone too',
  );
  assert.deepEqual(fitLines(lines, 5, { gap: '- ...' }), [], 'one line that does not fit is no field at all');
});

test('fitLines without a gap trims from the end', () => {
  assert.deepEqual(fitLines(['aaaa', 'bbbb', 'cccc'], 9), ['aaaa', 'bbbb']);
  assert.deepEqual(fitLines([], 10), []);
});

test('a malformed record drops its fields instead of throwing out of the whole log', () => {
  // Each of these threw before: `discordCode` called `.includes` on a non-string, which took
  // down every notification channel at once rather than spoiling one line.
  const bad = [
    { type: 'meet_again', timestamp: '2026-09-01T10:00:00Z', location: 'wrld_a', worldName: 7 as unknown as string },
    { type: 'meet_again', timestamp: '2026-09-01T11:00:00Z', location: null as unknown as string, worldName: 'W' },
    { type: 'friend_statusdesc', notifType: 'statusdesc', timestamp: '2026-09-01T12:00:00Z', location: '', worldName: '', message: 9 as unknown as string },
  ];
  const lines = userEventLines(bad, { format: 'discord' });
  assert.ok(lines.length > 0, 'the readable parts still render');
  assert.ok(lines.every((line) => typeof line === 'string'));

  // A group name that is not a string is dropped, not printed and not thrown over.
  const grouped = userEventLines(
    [{ type: 'meet_again', timestamp: '2026-09-01T10:00:00Z', location: 'wrld_a:1~group(grp_1)~groupAccessType(plus)', worldName: 'W' }],
    { format: 'discord', groupName: () => 42 as unknown as string },
  );
  assert.equal(grouped.length, 1);
  assert.doesNotMatch(grouped[0] ?? '', /42/);
});

test('knownGap draws the gap for a hole this call did not create', () => {
  const rows = [
    { type: 'meet_again', timestamp: '2026-10-02T22:00:00Z', location: 'wrld_a:1', worldName: 'Lotus' },
    { type: 'meet_again', timestamp: '2026-10-02T20:00:00Z', location: 'wrld_a:2', worldName: 'Lotus' },
    { type: 'instance_join', timestamp: '2022-01-04T18:26:02Z', location: 'wrld_z:9', worldName: 'Apartment' },
  ];
  // Three entries and a limit of twelve: nothing is dropped, so truncation cannot know there is
  // a four-year hole above the last row. The caller can.
  const quiet = userEventRows(rows, { limit: 12, oldest: true });
  assert.equal(quiet.includes(TIMELINE_GAP), false);
  assert.equal(quiet.length, 3);

  const told = userEventRows(rows, { limit: 12, oldest: true, knownGap: true });
  assert.equal(told.at(-2), TIMELINE_GAP);
  assert.notEqual(told.at(-1), TIMELINE_GAP);
  assert.equal(told.length, 4, 'every row it had, plus the gap');

  // The pinned row is never also left in the head.
  const ids = told.filter((row) => row !== TIMELINE_GAP).map((row) => row.event.timestamp);
  assert.equal(new Set(ids).size, ids.length);
});
