import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  groupIdOf,
  profileLoaded,
  toAvatarPerformance,
  toCurrentInstance,
  toInstanceAvatar,
  toUserGroups,
} from './vrcnext-data.js';

const LOCATION = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:60529~group(grp_11111111-2222-3333-4444-555555555555)~groupAccessType(plus)~region(eu)';

test('groupIdOf reads the group out of a location and is empty otherwise', () => {
  assert.equal(groupIdOf(LOCATION), 'grp_11111111-2222-3333-4444-555555555555');
  assert.equal(groupIdOf('wrld_x:1~friends(usr_y)~region(us)'), '');
});

test('toCurrentInstance narrows the PushCurrentInstanceFromCache shape', () => {
  const instance = toCurrentInstance({
    location: LOCATION,
    worldId: 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    worldName: 'Club',
    instanceType: 'group-plus',
    users: [
      { id: 'usr_1', displayName: 'A', ageVerified: true, ageVerificationStatus: '18+', platform: 'standalonewindows', tags: ['system_trust_veteran'], lastLogin: '2026-09-26', avatarId: 'avtr_1', avatarName: 'Ava' },
      { id: '', displayName: 'Legacy', ageVerified: false },
      'garbage',
    ],
  });
  assert.ok(instance !== undefined);
  assert.equal(instance.groupId, 'grp_11111111-2222-3333-4444-555555555555');
  const [first, second] = instance.users;
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(instance.users.length, 2);
  assert.equal(profileLoaded(first), true);
  assert.equal(profileLoaded(second), false);
  assert.equal(first.avatarId, 'avtr_1');
});

test('toCurrentInstance rejects the empty and error variants', () => {
  assert.equal(toCurrentInstance({ empty: true }), undefined);
  assert.equal(toCurrentInstance({ error: 'boom' }), undefined);
  assert.equal(toCurrentInstance(null), undefined);
});

test('toUserGroups keeps only group ids', () => {
  const groups = toUserGroups({ userId: 'usr_1', groups: [{ id: 'grp_a', members: 3 }, { members: 1 }, 'x'] });
  assert.deepEqual(groups, { userId: 'usr_1', groupIds: ['grp_a'] });
  assert.equal(toUserGroups({ groups: [] }), undefined);
});

test('avatar narrowers read the FriendsController and MessageRouter payloads', () => {
  assert.deepEqual(toInstanceAvatar({ userId: 'usr_1', avatarId: 'avtr_1', avatarName: 'Ava' }), { userId: 'usr_1', avatarId: 'avtr_1', avatarName: 'Ava' });
  assert.deepEqual(toAvatarPerformance({ id: 'avtr_1', name: 'Ava', pcPerf: 'Good', questPerf: 'VeryPoor' }), { avatarId: 'avtr_1', name: 'Ava', pc: 'Good', quest: 'VeryPoor' });
  assert.equal(toAvatarPerformance({ name: 'no id' }), undefined);
});
