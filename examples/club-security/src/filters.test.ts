import assert from 'node:assert/strict';
import { test } from 'vitest';

import { describeFilter, instanceMatches, splitList, type InstanceFilter } from './filters.js';
import type { CurrentInstance } from './vrcnext-data.js';

const GROUP = 'grp_11111111-2222-3333-4444-555555555555';
const WORLD = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function instance(overrides: Partial<CurrentInstance> = {}): CurrentInstance {
  return {
    location: `${WORLD}:12345~group(${GROUP})~groupAccessType(public)~region(eu)`,
    worldId: WORLD,
    worldName: 'The Club',
    instanceType: 'group-public',
    groupId: GROUP,
    users: [],
    ...overrides,
  };
}

const any: InstanceFilter = { instanceTypes: [], groupId: '', worldIds: [] };

test('splitList accepts commas, spaces and mixed case', () => {
  assert.deepEqual(splitList(' Group-Public, group-plus  friends+ '), ['group-public', 'group-plus', 'friends+']);
  assert.deepEqual(splitList(''), []);
});

test('an empty filter matches every instance', () => {
  assert.equal(instanceMatches(any, instance()), true);
  assert.equal(instanceMatches(any, instance({ instanceType: 'public', groupId: '' })), true);
});

test('"group" matches every group access type, a specific type only itself', () => {
  const group: InstanceFilter = { ...any, instanceTypes: ['group'] };
  assert.equal(instanceMatches(group, instance({ instanceType: 'group-plus' })), true);
  assert.equal(instanceMatches(group, instance({ instanceType: 'public' })), false);
  const plus: InstanceFilter = { ...any, instanceTypes: ['group-plus'] };
  assert.equal(instanceMatches(plus, instance({ instanceType: 'group-public' })), false);
});

test('group and world filters compare case-insensitively', () => {
  const byGroup: InstanceFilter = { ...any, groupId: GROUP.toUpperCase() };
  assert.equal(instanceMatches(byGroup, instance()), true);
  assert.equal(instanceMatches(byGroup, instance({ groupId: 'grp_other' })), false);
  const byWorld: InstanceFilter = { ...any, worldIds: [WORLD] };
  assert.equal(instanceMatches(byWorld, instance({ worldId: WORLD.toUpperCase() })), true);
  assert.equal(instanceMatches(byWorld, instance({ worldId: 'wrld_other' })), false);
});

test('describeFilter names what is restricted', () => {
  assert.equal(describeFilter(any), 'every instance');
  assert.equal(
    describeFilter({ instanceTypes: ['group'], groupId: GROUP, worldIds: [WORLD, 'wrld_b'] }),
    `types: group · group: ${GROUP} · worlds: 2`,
  );
});
