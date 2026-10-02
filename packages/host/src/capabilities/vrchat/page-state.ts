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
declare const vrcFriendsData: unknown;
declare const myGroups: unknown;
declare const favFriendGroups: unknown;
declare const favWorldsData: unknown;
declare const favAvatarsData: unknown;
declare const avatarsData: unknown;
declare const notifications: unknown;
declare const _recentSeenData: unknown;
declare const favFriendsData: unknown;
declare const worldInfoCache: unknown;
declare const avatarInfoCache: unknown;
declare const dashGroupCache: unknown;
declare const dashWorldCache: unknown;

/**
 * One guarded read of a page global.
 *
 * `undefined` for every way it can fail to be an answer: the name is not declared in this build
 * (`ReferenceError` on reference), or VRCNext has not loaded it yet (it initialises these to
 * `null`). Callers must treat that as "not known" and fall back to asking.
 */
function pageValue(read: () => unknown): unknown {
  try {
    const value = read();
    return value === null ? undefined : value;
  } catch {
    return undefined;
  }
}

/** A page global that holds a list, or `undefined` when it is not loaded or not an array. */
export function pageArray(read: () => unknown): readonly unknown[] | undefined {
  const value = pageValue(read);
  return Array.isArray(value) ? value : undefined;
}

/** A page global that holds an id-keyed cache, or `undefined` when it is not loaded. */
function pageRecord(read: () => unknown): Readonly<Record<string, unknown>> | undefined {
  const value = pageValue(read);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

/**
 * The lists VRCNext loads for its own screens and keeps current.
 *
 * Each is what the matching push carries, so a mirror's own parser reads it unchanged — except
 * where the push wraps the list in an object and the page global is the bare array, which is
 * why some of these are wrapped back up here. The shape belongs with the global it describes.
 */
export const pageLists = {
  /** `vrcFriends`: every friend VRCNext has loaded. */
  friends: (): unknown => pageArray(() => vrcFriendsData),
  /** `vrcMyGroups`: the groups the account is in. */
  myGroups: (): unknown => pageArray(() => myGroups),
  /** `vrcFavoriteFriends`: the favourite-friend groups, with their names. */
  favoriteGroups: (): unknown => pageArray(() => favFriendGroups),
  /** `vrcFavoriteWorlds` wraps its list in `{ worlds }`. */
  favoriteWorlds: (): unknown => wrap('worlds', pageArray(() => favWorldsData)),
  /** `vrcFavoriteAvatars` wraps its list in `{ avatars }`. */
  favoriteAvatars: (): unknown => wrap('avatars', pageArray(() => favAvatarsData)),
  /** `vrcAvatars` carries the filter it answered for alongside the list. */
  ownAvatars: (): unknown => {
    const list = pageArray(() => avatarsData);
    return list === undefined ? undefined : { filter: 'own', avatars: list };
  },
  /** `vrcNotifications`: the unread ones VRCNext is showing. */
  notifications: (): unknown => pageArray(() => notifications),
  /** `recentSeenPlayers` wraps its list in `{ players }`. */
  recentPlayers: (): unknown => wrap('players', pageArray(() => _recentSeenData)),
  /**
   * `vrcFavoriteFriends` wraps its list in `{ friends }`, each carrying `favoriteId`.
   *
   * The page's own array is the favourite *records* — `{ fvrtId, favoriteId, groupName }` — which
   * is the same shape the push carries, so the normaliser reads it unchanged.
   */
  favoriteFriends: (): unknown => wrap('friends', pageArray(() => favFriendsData)),
} as const;

/** `{ [key]: list }`, or `undefined` so a missing list stays missing rather than becoming empty. */
function wrap(key: string, list: readonly unknown[] | undefined): unknown {
  return list === undefined ? undefined : { [key]: list };
}

/**
 * A name VRCNext has already resolved, from the caches its own screens fill.
 *
 * These are name-and-thumbnail caches, not full records: `worldInfoCache` holds `{ id, name,
 * thumbnailImageUrl }` and `dashGroupCache` holds `{ name, shortCode }`. That is exactly enough
 * for the one question most lookups are really asking — what is this id called — and nothing
 * like enough for the rest, so a caller that needs the whole world or group still asks for it.
 */
export function pageName(cache: 'world' | 'avatar' | 'group', id: string): string | undefined {
  if (id === '') return undefined;
  for (const read of CACHES[cache]) {
    const entry = pageRecord(read)?.[id];
    const name = typeof entry === 'object' && entry !== null
      ? (entry as Record<string, unknown>)['name']
      : undefined;
    if (typeof name === 'string' && name !== '') return name;
  }
  return undefined;
}

/**
 * Where each kind of name may already be.
 *
 * Worlds have two caches because two screens fill different ones: the world modal fills
 * `worldInfoCache`, the dashboard fills `dashWorldCache`. Either is an answer.
 */
const CACHES: Readonly<Record<'world' | 'avatar' | 'group', readonly (() => unknown)[]>> = {
  world: [() => worldInfoCache, () => dashWorldCache],
  avatar: [() => avatarInfoCache],
  group: [() => dashGroupCache],
};

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
  const value = pageArray(read);
  if (value === undefined) return undefined;
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
