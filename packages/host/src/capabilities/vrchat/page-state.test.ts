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
  'vrcFriendsData', 'vrcFriendsLoaded', 'myGroups', 'myGroupsLoaded', 'favFriendGroups',
  'favFriendsData', '_pplFavLoaded', 'favWorldsData', '_favWorldsLoaded', '_visitedWorldsData',
  '_visitedWorldsLoaded', 'favAvatarsData', '_recentAvatarsData', '_avCountsLoaded',
  'avatarsData', 'avatarsLoaded', 'avatarFilter', '_recentSeenData', '_pplRecentLoaded',
  'notifications', 'currentInstanceData', 'worldInfoCache', 'avatarInfoCache', 'dashGroupCache',
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

test('an empty list is only an answer once VRCNext says it loaded it', () => {
  // Every one of these arrays starts as `[]`, not `null`, so "empty" and "never fetched" look
  // identical without the flag. Answering `[]` for a tab the user never opened would tell a
  // plugin there are no favourite worlds instead of fetching them.
  setGlobal('favWorldsData', []);
  assert.equal(pageLists.favoriteWorlds(), undefined, 'empty and unloaded: go and ask');

  setGlobal('_favWorldsLoaded', true);
  assert.deepEqual(pageLists.favoriteWorlds(), { worlds: [] }, 'empty and loaded: there really are none');

  setGlobal('favWorldsData', [{ id: 'wrld_1', name: 'W' }]);
  assert.deepEqual(pageLists.favoriteWorlds(), { worlds: [{ id: 'wrld_1', name: 'W' }] });
});

test('a list is read in the shape its own push carries', () => {
  setGlobal('vrcFriendsData', [{ id: 'usr_1', displayName: 'A' }]);
  setGlobal('vrcFriendsLoaded', true);
  setGlobal('_recentSeenData', [{ id: 'usr_2' }]);
  setGlobal('_pplRecentLoaded', true);
  assert.deepEqual(pageLists.friends(), [{ id: 'usr_1', displayName: 'A' }], 'this push is the bare array');
  assert.deepEqual(pageLists.recentPlayers(), { players: [{ id: 'usr_2' }] }, 'this one wraps it');
  assert.equal(pageLists.myGroups(), undefined, 'a list nothing has loaded stays missing');
});

test('the avatar lists are per tab, and the own list is only own while that filter is showing', () => {
  setGlobal('avatarsData', [{ id: 'avtr_1', name: 'Mine' }]);
  setGlobal('avatarsLoaded', true);
  setGlobal('avatarFilter', 'favorites');
  assert.equal(pageLists.ownAvatars(), undefined,
    'under another filter this array is somebody else’s avatars, not the user’s uploads');

  setGlobal('avatarFilter', 'own');
  assert.deepEqual(pageLists.ownAvatars(), { filter: 'own', avatars: [{ id: 'avtr_1', name: 'Mine' }] });

  setGlobal('_recentAvatarsData', [{ id: 'avtr_2' }]);
  assert.equal(pageLists.recentAvatars(), undefined, 'its own tab flag has not been set');
  setGlobal('_avCountsLoaded', { own: true, favorites: false, recent: true });
  assert.deepEqual(pageLists.recentAvatars(), { avatars: [{ id: 'avtr_2' }] });
  assert.equal(pageLists.favoriteAvatars(), undefined, 'and the favourites tab is still unloaded');
});

test('the current instance is read untouched, including VRCNext’s "not in one"', () => {
  assert.equal(pageLists.instance(), undefined, 'null until the first push');
  setGlobal('currentInstanceData', { empty: true });
  assert.deepEqual(pageLists.instance(), { empty: true },
    'passed through, so the mirror’s own parser decides what it means');
  setGlobal('currentInstanceData', { location: 'wrld_1:5', worldName: 'W' });
  assert.deepEqual(pageLists.instance(), { location: 'wrld_1:5', worldName: 'W' });
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
