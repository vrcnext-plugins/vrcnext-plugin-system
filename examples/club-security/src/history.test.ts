import assert from 'node:assert/strict';
import { test } from 'vitest';

import { instanceKey, rejoinIn, toTimelineEntries } from './history.js';

const HERE = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~group(grp_1)~groupAccessType(plus)~region(eu)';
const SAME_INSTANCE_OTHER_MODIFIERS = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~group(grp_1)';
const SAME_WORLD_OTHER_INSTANCE = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:99999~region(eu)';
const NOW = Date.parse('2026-09-27T12:00:00Z');

test('instanceKey strips modifiers', () => {
  assert.equal(instanceKey(HERE), 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345');
  assert.equal(instanceKey(''), '');
});

test('toTimelineEntries matches on user id and keeps only time and place', () => {
  assert.equal(toTimelineEntries({ userId: 'usr_2', events: [] }, 'usr_1'), undefined);
  assert.deepEqual(
    toTimelineEntries({ userId: 'usr_1', events: [{ type: 'meet_again', timestamp: 't', worldName: 'W', location: HERE }, 'junk'] }, 'usr_1'),
    [{ timestamp: 't', location: HERE }],
  );
});

test('an earlier visit to the same instance is a rejoin, with the most recent time', () => {
  const r = rejoinIn([
    { timestamp: '2026-09-27T11:59:58Z', location: HERE },                 // this join
    { timestamp: '2026-09-27T09:00:00Z', location: SAME_INSTANCE_OTHER_MODIFIERS },
    { timestamp: '2026-09-27T10:00:00Z', location: SAME_WORLD_OTHER_INSTANCE },
    { timestamp: '2026-09-20T20:00:00Z', location: HERE },
  ], HERE, NOW);
  assert.equal(r.seenHere, true);
  assert.equal(r.lastAt, '2026-09-27T09:00:00Z');
});

test('the same world in another instance, or only this join, is not a rejoin', () => {
  assert.equal(rejoinIn([{ timestamp: '2026-09-27T10:00:00Z', location: SAME_WORLD_OTHER_INSTANCE }], HERE, NOW).seenHere, false);
  assert.equal(rejoinIn([{ timestamp: '2026-09-27T11:59:59Z', location: HERE }], HERE, NOW).seenHere, false);
  assert.equal(rejoinIn([], HERE, NOW).seenHere, false);
});

test('no answer from VRCNext is unknown, not no', () => {
  assert.equal(rejoinIn(undefined, HERE, NOW).seenHere, undefined);
});
