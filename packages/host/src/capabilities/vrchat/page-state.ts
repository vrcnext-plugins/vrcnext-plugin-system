/**
 * State VRCNext's own page already holds, read in place.
 *
 * Some of what a report wants to say is not a lookup at all — the app has it loaded and is
 * keeping it current. The five moderation lists are the clearest case: they are the signed-in
 * account's, VRCNext fetches them **once every two hours** at login
 * (`window._lastModerationFetch` in `messages.js`), patches them in place whenever you block or
 * unblock someone (`vrcModDone`), and every profile card it draws reads those same arrays. The
 * app does not spend a request to open a profile and neither should a plugin.
 *
 * Asking VRCNext for them again is not free: `vrcGetAllModerations` is five uncached
 * `GET /auth/user/playermoderations?type=…` calls, one per kind, with no cache layer behind it
 * (`PlayerModerationAPI.cs`). Mirroring them into the host instead would be a second copy of
 * data the page is already maintaining, and it would be stale for whatever window the mirror
 * missed. Reading the page's own arrays is both cheaper and more correct: a block made a second
 * ago is already in them.
 *
 * ## Why these are not on `globalThis`
 *
 * VRCNext declares them as top-level `let` in a classic script. Those bindings live in the
 * global *lexical* environment, which is not `window` — `window.blockedData` is `undefined`
 * while the bare name resolves fine. The host bundle is a classic script too, so a bare
 * reference reaches the same binding through the scope chain. That is why these are `declare`d
 * and read inside a guard rather than looked up as properties: the lookup that works for
 * `getInstanceBadge` (a function declaration, which does land on `window`) does not work here.
 *
 * Every read is defensive. A name VRCNext renames, or has not declared yet, throws
 * `ReferenceError` on reference, and a list it has not loaded is `null`. Both come back as
 * `undefined`, which callers must treat as "not known" rather than as "empty".
 */

import { str } from './normalise.js';

// VRCNext's own page globals. Declared, not imported: they are another script's bindings.
declare const blockedData: unknown;
declare const mutedData: unknown;
declare const muteChatData: unknown;
declare const hiddenAvatarData: unknown;
declare const interactOffData: unknown;

/** The user ids in each of VRCNext's moderation lists; `undefined` for one it has not loaded. */
export interface PageModerationLists {
  readonly block: readonly string[] | undefined;
  readonly mute: readonly string[] | undefined;
  readonly muteChat: readonly string[] | undefined;
  readonly hideAvatar: readonly string[] | undefined;
  readonly interactOff: readonly string[] | undefined;
}

/**
 * The ids in one of the page's moderation arrays.
 *
 * The entries are `{ targetUserId, targetDisplayName, image }` — the shape VRCNext's own card
 * tests with `.some(x => x.targetUserId === userId)`. `undefined` when the value is not an
 * array, which is how VRCNext spells "not loaded yet" (it initialises them to `null`).
 */
function targets(read: () => unknown): readonly string[] | undefined {
  let value: unknown;
  try {
    value = read();
  } catch {
    // ReferenceError: this build of VRCNext does not declare that name.
    return undefined;
  }
  if (!Array.isArray(value)) return undefined;
  return value
    .map((entry) => (typeof entry === 'object' && entry !== null ? str((entry as Record<string, unknown>)['targetUserId']) : ''))
    .filter((id) => id !== '');
}

/** The five lists as the page holds them right now. No request, no copy. */
export function pageModerationLists(): PageModerationLists {
  return {
    block: targets(() => blockedData),
    mute: targets(() => mutedData),
    muteChat: targets(() => muteChatData),
    hideAvatar: targets(() => hiddenAvatarData),
    interactOff: targets(() => interactOffData),
  };
}
