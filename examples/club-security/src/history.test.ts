import assert from 'node:assert/strict';
import { test } from 'vitest';

import { instanceTypeOf, shapeOfLocation, type InstanceFilter } from './filters.js';
import { summarise, toMeetEvent, toTimelineEntries } from './history.js';

const GROUP = 'grp_11111111-2222-3333-4444-555555555555';
const CLUB = `wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:1~group(${GROUP})~groupAccessType(plus)~region(eu)`;
const HOME = 'wrld_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee:2~hidden(usr_me)~region(eu)';
const any: InstanceFilter = { instanceTypes: [], groupId: '', worldIds: [] };
const NOW = Date.parse('2026-09-27T12:00:00Z');

test('instanceTypeOf mirrors VRCNext’s ParseLocation', () => {
  assert.equal(instanceTypeOf(CLUB), 'group-plus');
  assert.equal(instanceTypeOf(HOME), 'hidden');
  assert.equal(instanceTypeOf('wrld_x:1~private(usr_y)~canRequestInvite~region(us)'), 'invite_plus');
  assert.equal(instanceTypeOf('wrld_x:1~private(usr_y)'), 'private');
  assert.equal(instanceTypeOf('wrld_x:1~friends+(usr_y)'), 'friends+');
  assert.equal(instanceTypeOf('wrld_x:1~group(grp_z)'), 'group');
  assert.equal(instanceTypeOf('wrld_x:1~region(eu)'), 'public');
  assert.deepEqual(shapeOfLocation(CLUB), { worldId: 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', instanceType: 'group-plus', groupId: GROUP });
});

test('toMeetEvent accepts only first_meet and meet_again with a user', () => {
  assert.deepEqual(toMeetEvent({ type: 'meet_again', userId: 'usr_1', timestamp: 't', meetCount: 3 }), { type: 'meet_again', userId: 'usr_1', timestamp: 't', meetCount: 3 });
  assert.equal(toMeetEvent({ type: 'instance_join', userId: 'usr_1' }), undefined);
  assert.equal(toMeetEvent({ type: 'first_meet' }), undefined);
});

test('toTimelineEntries matches on user id', () => {
  assert.equal(toTimelineEntries({ userId: 'usr_2', events: [] }, 'usr_1'), undefined);
  assert.deepEqual(toTimelineEntries({ userId: 'usr_1', events: [{ type: 'meet_again', timestamp: 't', worldName: 'W', location: HOME }, 'junk'] }, 'usr_1'), [{ type: 'meet_again', timestamp: 't', worldName: 'W', location: HOME }]);
});

test('a first meeting with no earlier events is a first-timer', () => {
  const h = summarise({ type: 'first_meet', userId: 'usr_1', timestamp: 't', meetCount: 0 }, [], any, NOW);
  assert.equal(h.metBefore, false);
  assert.equal(h.lastMet, undefined);
  assert.equal(h.matchingBefore, 0);
});

test('a repeat meeting reports the latest earlier event and counts matching ones', () => {
  const events = [
    { type: 'meet_again', timestamp: '2026-09-27T11:59:58Z', worldName: 'Club', location: CLUB },   // this join
    { type: 'meet_again', timestamp: '2026-09-20T20:00:00Z', worldName: 'Club', location: CLUB },
    { type: 'instance_join', timestamp: '2026-09-25T21:00:00Z', worldName: 'Home', location: HOME },
    { type: 'first_meet', timestamp: '2026-09-01T10:00:00Z', worldName: 'Club', location: CLUB },
  ];
  const byGroup: InstanceFilter = { ...any, groupId: GROUP };
  const h = summarise({ type: 'meet_again', userId: 'usr_1', timestamp: 't', meetCount: 3 }, events, byGroup, NOW);
  assert.equal(h.metBefore, true);
  assert.equal(h.meetCount, 3);
  assert.deepEqual(h.lastMet, { at: '2026-09-25T21:00:00Z', worldName: 'Home' });
  assert.equal(h.matchingBefore, 2);
  assert.equal(h.windowSize, 3);
});

test('without the live event the timeline alone decides, and nothing at all is unknown', () => {
  const only = [{ type: 'meet_again', timestamp: '2026-09-20T20:00:00Z', worldName: 'Club', location: CLUB }];
  assert.equal(summarise(undefined, only, any, NOW).metBefore, true);
  assert.equal(summarise(undefined, [], any, NOW).metBefore, false);
  assert.equal(summarise(undefined, undefined, any, NOW).metBefore, undefined);
  assert.equal(summarise(undefined, undefined, any, NOW).matchingBefore, undefined);
});
