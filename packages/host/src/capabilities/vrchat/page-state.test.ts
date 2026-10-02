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

import { pageModerationLists } from './page-state.js';

const NAMES = ['blockedData', 'mutedData', 'muteChatData', 'hiddenAvatarData', 'interactOffData'] as const;

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
