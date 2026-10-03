/**
 * What survives the trip from VRCNext's payloads into the plugin API's shapes.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { timelineEvent } from './normalise.js';

test('an instance_join keeps each person\'s sessions', () => {
  // `BuildTimelinePayload` sends `players[].joinedAts/leftAts`, and they are the only record of
  // a second visit to one instance: VRCNext files one timeline record per person per instance,
  // however often they came and went.
  const event = timelineEvent({
    type: 'instance_join',
    timestamp: '2026-10-03T21:10:14Z',
    location: 'wrld_a:43154~group(grp_1)',
    worldName: 'Fjord Party Club',
    players: [
      {
        userId: 'usr_1',
        displayName: 'Deahtpink',
        joinedAts: ['2026-10-03T21:51:36Z', '2026-10-03T23:00:53Z'],
        leftAts: ['2026-10-03T22:47:17Z'],
      },
      // Not a person: no id, nothing to look anyone up by.
      { displayName: 'nobody' },
    ],
  });
  assert.deepEqual(event?.players, [{
    userId: 'usr_1',
    displayName: 'Deahtpink',
    joinedAts: ['2026-10-03T21:51:36Z', '2026-10-03T23:00:53Z'],
    leftAts: ['2026-10-03T22:47:17Z'],
  }]);
});

test('a record with no players is an empty list, not a missing one', () => {
  // Every type but `instance_join`, and every VRCX import.
  const event = timelineEvent({ type: 'meet_again', timestamp: '2026-10-03T21:51:36Z', location: 'wrld_a:43154' });
  assert.deepEqual(event?.players, []);
});
