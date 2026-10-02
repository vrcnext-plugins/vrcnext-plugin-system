/**
 * The page reads against fake globals.
 *
 * A bare identifier resolves to a property of the global object when no lexical binding shadows
 * it, so assigning `globalThis.blockedData` is enough to stand in for VRCNext's own top-level
 * `let`. Deleting it again puts the reference back to throwing `ReferenceError`, which is the
 * case that matters most: it is what a renamed or not-yet-declared global looks like.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { pageLists, pageModerationLists, pageName } from './page-state.js';

const NAMES = [
  'blockedData', 'mutedData', 'muteChatData', 'hiddenAvatarData', 'interactOffData',
  'vrcFriendsData', 'myGroups', 'favFriendGroups', 'favWorldsData', 'favAvatarsData',
  'avatarsData', 'notifications', 'worldInfoCache', 'avatarInfoCache', 'dashGroupCache',
  'dashWorldCache',
] as const;

function setGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

afterEach(() => {
  // `undefined` rather than `delete`: the reference then resolves and is not an array, which is
  // the same answer as a list VRCNext has not loaded. The ReferenceError path is covered by the
  // first test, which runs before anything is assigned.
  for (const name of NAMES) setGlobal(name, undefined);
});

test('a global VRCNext has not declared reads as not known, not as empty', () => {
  const lists = pageModerationLists();
  assert.deepEqual(lists, {
    block: undefined, mute: undefined, muteChat: undefined, hideAvatar: undefined, interactOff: undefined,
  }, 'a ReferenceError is "could not be checked", which must never clear anyone');
});

test('a list VRCNext has not loaded yet is null, which is also not known', () => {
  for (const name of NAMES) setGlobal(name, null);
  assert.equal(pageModerationLists().block, undefined);
});

test('the ids come out of the entries VRCNext stores', () => {
  setGlobal('blockedData', [
    { targetUserId: 'usr_1', targetDisplayName: 'A', image: '' },
    { targetUserId: 'usr_2', targetDisplayName: 'B', image: '' },
  ]);
  setGlobal('mutedData', []);
  const lists = pageModerationLists();
  assert.deepEqual(lists.block, ['usr_1', 'usr_2']);
  assert.deepEqual(lists.mute, [], 'loaded and empty is an answer: nobody is muted');
  assert.equal(lists.muteChat, undefined, 'the others are still unknown');
});

test('junk in a list is skipped rather than read as an id', () => {
  setGlobal('blockedData', [{ targetUserId: 'usr_1' }, null, 'nonsense', {}, { targetUserId: 42 }]);
  assert.deepEqual(pageModerationLists().block, ['usr_1']);
});

test('a list VRCNext already holds is read in place, in the shape its push carries', () => {
  setGlobal('vrcFriendsData', [{ id: 'usr_1', displayName: 'A' }]);
  setGlobal('favWorldsData', [{ id: 'wrld_1', name: 'W' }]);
  setGlobal('avatarsData', [{ id: 'avtr_1', name: 'A' }]);
  assert.deepEqual(pageLists.friends(), [{ id: 'usr_1', displayName: 'A' }], 'the push is the bare array');
  assert.deepEqual(pageLists.favoriteWorlds(), { worlds: [{ id: 'wrld_1', name: 'W' }] }, 'this push wraps it');
  assert.deepEqual(pageLists.ownAvatars(), { filter: 'own', avatars: [{ id: 'avtr_1', name: 'A' }] });
  // A list that is not there stays missing rather than becoming an empty one, so a caller still
  // knows to ask.
  assert.equal(pageLists.favoriteAvatars(), undefined);
  assert.equal(pageLists.myGroups(), undefined);
});

test('a name VRCNext already resolved comes from whichever cache has it', () => {
  setGlobal('worldInfoCache', { wrld_1: { id: 'wrld_1', name: 'Jellybean' } });
  setGlobal('dashWorldCache', { wrld_2: { name: 'Dashboard only' } });
  setGlobal('dashGroupCache', { grp_1: { name: 'Club Security', shortCode: 'CLUB' } });
  setGlobal('avatarInfoCache', { avtr_1: { id: 'avtr_1', name: 'Ava' } });

  assert.equal(pageName('world', 'wrld_1'), 'Jellybean');
  assert.equal(pageName('world', 'wrld_2'), 'Dashboard only', 'the second world cache is an answer too');
  assert.equal(pageName('group', 'grp_1'), 'Club Security');
  assert.equal(pageName('avatar', 'avtr_1'), 'Ava');

  assert.equal(pageName('world', 'wrld_missing'), undefined, 'not cached is not "no such world"');
  assert.equal(pageName('group', ''), undefined);
  assert.equal(pageName('avatar', 'avtr_1'), 'Ava');
});

test('a cache entry without a usable name is not an answer', () => {
  setGlobal('dashGroupCache', { grp_1: { name: '' }, grp_2: { shortCode: 'X' }, grp_3: null });
  for (const id of ['grp_1', 'grp_2', 'grp_3']) assert.equal(pageName('group', id), undefined);
});
