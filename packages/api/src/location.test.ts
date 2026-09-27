import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isGroupInstance, parseLocation } from './location.js';

const WORLD = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('parses a group instance with its access type, group and region', () => {
  const parsed = parseLocation(`${WORLD}:60529~group(grp_1)~groupAccessType(plus)~region(eu)`);
  assert.deepEqual(parsed, {
    worldId: WORLD,
    instanceId: '60529',
    key: `${WORLD}:60529`,
    instanceType: 'group-plus',
    groupId: 'grp_1',
    ownerId: '',
    region: 'eu',
  });
  assert.equal(isGroupInstance(parsed.instanceType), true);
});

test('names every access type as VRCNext does', () => {
  const type = (mods: string): string => parseLocation(`${WORLD}:1${mods}`).instanceType;
  assert.equal(type('~region(us)'), 'public');
  assert.equal(type('~friends+(usr_1)'), 'friends+');
  assert.equal(type('~friends(usr_1)'), 'friends');
  assert.equal(type('~hidden(usr_1)'), 'hidden');
  assert.equal(type('~private(usr_1)'), 'private');
  assert.equal(type('~private(usr_1)~canRequestInvite'), 'invite_plus');
  assert.equal(type('~group(grp_1)~groupAccessType(public)'), 'group-public');
  assert.equal(type('~group(grp_1)~groupAccessType(members)'), 'group-members');
  assert.equal(parseLocation(`${WORLD}:1~friends(usr_1)`).ownerId, 'usr_1');
});

test('non-instance locations have no key or type', () => {
  for (const location of ['offline', 'private', 'traveling', '', WORLD]) {
    const parsed = parseLocation(location);
    assert.equal(parsed.key, '', location);
    assert.equal(parsed.instanceType, '', location);
  }
  assert.equal(parseLocation(WORLD).worldId, WORLD);
});
