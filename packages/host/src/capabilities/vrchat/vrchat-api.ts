/**
 * {@link VrchatApi} over VRCNext's event stream and the quiet channel.
 *
 * Two sources:
 *
 * - **Mirrors.** VRCNext pushes its lists (`vrcFriends`, favourites, `vrcMyGroups`,
 *   `vrcCurrentInstance`, …) on login and whenever they change. The host keeps the latest of
 *   each; a list method answers from the mirror and only asks VRCNext when it has nothing yet or
 *   the caller wants fresh data. Those replies are left for VRCNext to handle too: they refresh
 *   the lists it shows anyway.
 * - **Quiet lookups.** Details and searches are asked through the {@link QuietChannel}, so the
 *   reply reaches the plugin and not VRCNext's modal. Answers are cached briefly and identical
 *   concurrent lookups share one request.
 */

import { imageCacheKeyFor, publicImageUrl } from '@vrcnext/plugin-api';
import type {
  ActionArgs,
  ImageSubject,
  VrcAvatar,
  VrcAvatarSummary,
  VrcFavoriteGroup,
  VrcFriendInstance,
  VrcGroup,
  VrcGroupSummary,
  VrcInstance,
  VrcLookupOptions,
  VrcModerationCounts,
  VrcSearchOptions,
  VrcSearchPage,
  VrcSelf,
  VrcTimelineEvent,
  VrcModerations,
  VrcStatusTime,
  VrcUser,
  VrcUserSummary,
  VrcWorld,
  VrcWorldSummary,
  VrchatApi,
} from '@vrcnext/plugin-api';

import type { EventRouter } from '../../events/event-router.js';
import * as n from './normalise.js';
import { pageLists, pageModerationLists, pageName } from './page-state.js';
import { pageGlobal } from './page-global.js';
import type { QuietChannel } from './quiet-channel.js';

/** How long a detail answer is reused. Long enough for a settings card to draw, short enough to notice a status change. */
const DETAIL_TTL_MS = 60_000;

/** How many detail answers are kept; the least recently used goes first. */
const DETAIL_MAX_ENTRIES = 200;
const SEARCH_PAGE = 20;

/** `promise`, or the signal's reason as soon as it aborts, whichever comes first. */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      const reason: unknown = signal.reason;
      reject(reason instanceof Error ? reason : new DOMException('The lookup was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface Cached<T> {
  readonly at: number;
  readonly value: T;
}

/** A list VRCNext pushes: the last payload seen, and how to ask for it again. */
/** The first of these that is a non-empty string, or `''`. */
function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  return values.find((value) => value !== undefined && value !== '') ?? '';
}

class Mirror<T> {
  #value: T | undefined;
  readonly #read: (payload: unknown) => T | undefined;
  readonly #page: (() => unknown) | undefined;

  /**
   * `page` is where VRCNext already keeps this list in its own page state.
   *
   * Without it a mirror that has not seen its push yet has nothing, and the only way to answer
   * is to ask VRCNext to fetch the list again — which it has already fetched. A plugin enabled
   * after login is exactly that case, and for friends it meant a full `vrcRefreshFriends` to
   * rebuild a list of over a thousand people sitting in a variable one scope away.
   */
  constructor(read: (payload: unknown) => T | undefined, page?: () => unknown) {
    this.#read = read;
    this.#page = page;
  }

  /** Feeds a push; returns whether it was this list. */
  feed(payload: unknown): boolean {
    const value = this.#read(payload);
    if (value === undefined) return false;
    this.#value = value;
    return true;
  }

  /** The push if one arrived, else what the page is holding, else nothing. */
  get value(): T | undefined {
    if (this.#value !== undefined) return this.#value;
    const page = this.#page;
    return page === undefined ? undefined : this.#read(page());
  }

  read(payload: unknown): T | undefined {
    return this.#read(payload);
  }
}

export interface VrchatApiDeps {
  readonly router: EventRouter;
  readonly channel: QuietChannel;
  readonly now?: () => number;
  /**
   * Turns a VRCNext image-cache key into the address VRChat serves that picture from, or `''`.
   *
   * Injected rather than reached for, because the answer comes from the bridge reading VRCNext's
   * database and this class otherwise knows nothing about the bridge. Omitted — in tests, and on a
   * page whose bridge never connects — {@link HostVrchatApi.originalImageUrl} answers `''`, which
   * every caller already treats as "no picture to share".
   */
  readonly resolveImage?: (key: string) => Promise<string>;
}

/**
 * Cached public image addresses. Small: a report looks up two pictures, and the key is one
 * entity, so a session touches far fewer of these than it does profiles.
 */
const IMAGE_MAX_ENTRIES = 200;

export class HostVrchatApi implements VrchatApi {
  readonly #deps: VrchatApiDeps;
  readonly #unsubscribe: (() => void)[] = [];
  #self: VrcSelf | undefined;
  /**
   * Resolved public image addresses by cache key, most recently used last.
   *
   * Only answers are kept. A picture VRCNext has not cached yet has no row to find, and caching
   * that absence would mean the first report after startup poisons every later one — which is
   * exactly the case this whole path exists to fix. A miss is one cheap indexed lookup.
   */
  // reuse: the answers are the host's own work — VRCNext caches the picture on disk but
  // keeps no map of which public URL each cache key resolved to, which is what costs a lookup.
  readonly #images = new Map<string, string>();

  readonly #friends = new Mirror<readonly VrcUserSummary[]>((p) => {
    const r = n.rec(p);
    const raw = r !== undefined && Array.isArray(r['friends']) ? r['friends'] : Array.isArray(p) ? p : undefined;
    return raw === undefined ? undefined : n.each(raw, n.friendSummary);
  }, pageLists.friends);
  readonly #favoriteFriendIds = new Mirror<readonly string[]>(n.favoriteFriendIds, pageLists.favoriteFriends);
  readonly #favoriteGroups = new Mirror<readonly VrcFavoriteGroup[]>(n.favoriteGroups, pageLists.favoriteGroups);
  readonly #recentPlayers = new Mirror<readonly VrcUserSummary[]>((p) => {
    const players = n.rec(p)?.['players'];
    return Array.isArray(players) ? n.each(players, n.userSummary) : undefined;
  }, pageLists.recentPlayers);
  readonly #favoriteWorlds = new Mirror<readonly VrcWorldSummary[]>((p) => {
    const worlds = n.rec(p)?.['worlds'];
    return Array.isArray(worlds) ? n.each(worlds, n.worldSummary) : undefined;
  }, pageLists.favoriteWorlds);
  // reuse: no page state — VRCNext renders visited worlds straight from the push and keeps no
  // array of them, so this mirror is the only copy there is.
  readonly #recentWorlds = new Mirror<readonly VrcWorldSummary[]>((p) => {
    const worlds = n.rec(p)?.['worlds'];
    return Array.isArray(worlds) ? n.each(worlds, n.worldSummary) : undefined;
  });
  readonly #ownAvatars = new Mirror<readonly VrcAvatarSummary[]>((p) => {
    const r = n.rec(p);
    return r?.['filter'] === 'own' && Array.isArray(r['avatars']) ? n.each(r['avatars'], n.avatarSummary) : undefined;
  }, pageLists.ownAvatars);
  readonly #favoriteAvatars = new Mirror<readonly VrcAvatarSummary[]>((p) => {
    const avatars = n.rec(p)?.['avatars'];
    return Array.isArray(avatars) ? n.each(avatars, n.avatarSummary) : undefined;
  }, pageLists.favoriteAvatars);
  // reuse: no page state — same as recent worlds; the avatar picker renders the push directly.
  readonly #recentAvatars = new Mirror<readonly VrcAvatarSummary[]>((p) => {
    const avatars = n.rec(p)?.['avatars'];
    return Array.isArray(avatars) ? n.each(avatars, n.avatarSummary) : undefined;
  });
  readonly #myGroups = new Mirror<readonly VrcGroupSummary[]>((p) =>
    Array.isArray(p) ? n.each(p, (g) => {
      const group = n.groupSummary(g);
      return group === undefined ? undefined : { ...group, isJoined: true };
    }) : undefined,
  pageLists.myGroups);
  /** `{ instance }` so "not in an instance" is a known answer rather than an empty mirror. */
  readonly #instance = new Mirror<{ readonly instance: VrcInstance | undefined }>((p) =>
    n.rec(p) === undefined ? undefined : { instance: n.instance(p) },
  );

  // reuse: this is what avoids requests rather than causing them — the answers to quiet
  // lookups, held for DETAIL_TTL_MS so two reports on one arrival cost one lookup.
  readonly #details = new Map<string, Cached<unknown>>();
  readonly #inFlight = new Map<string, Promise<unknown>>();

  constructor(deps: VrchatApiDeps) {
    this.#deps = deps;
    const on = (type: string, listener: (payload: unknown) => void): void => {
      this.#unsubscribe.push(deps.router.on(type, listener));
    };
    on('vrcUser', (p) => {
      const self = n.self(p);
      if (self !== undefined) this.#self = self;
    });
    on('vrcFriends', (p) => { this.#friends.feed(p); });
    on('vrcFriendUpdate', (p) => { this.#patchFriend(p); });
    on('vrcFavoriteFriends', (p) => {
      this.#favoriteFriendIds.feed(p);
      this.#favoriteGroups.feed(p);
    });
    on('recentSeenPlayers', (p) => { this.#recentPlayers.feed(p); });
    on('vrcFavoriteWorlds', (p) => { this.#favoriteWorlds.feed(p); });
    on('visitedWorlds', (p) => { this.#recentWorlds.feed(p); });
    on('vrcAvatars', (p) => { this.#ownAvatars.feed(p); });
    on('vrcFavoriteAvatars', (p) => { this.#favoriteAvatars.feed(p); });
    on('recentAvatars', (p) => { this.#recentAvatars.feed(p); });
    on('vrcMyGroups', (p) => { this.#myGroups.feed(p); });
    on('vrcCurrentInstance', (p) => { this.#instance.feed(p); });
  }

  dispose(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe.length = 0;
  }

  #patchFriend(payload: unknown): void {
    const friend = n.friendSummary(payload);
    const current = this.#friends.value;
    if (friend === undefined || current === undefined) return;
    const index = current.findIndex((f) => f.id === friend.id);
    this.#friends.feed({ friends: index < 0 ? [...current, friend] : current.with(index, friend) });
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  /** A mirror's value, or the reply to asking VRCNext for it (which VRCNext also handles). */
  /**
   * A mirrored list: the push if it arrived, the page's own copy if not, and only then a request.
   *
   * reuse: cold start only. Every caller of this goes through a `Mirror` that reads VRCNext's
   * page state first, so the request is reached only when VRCNext has neither pushed the list
   * nor kept one — see `page-state.ts` and the two mirrors marked `no page state`.
   */
  async #list<T>(
    mirror: Mirror<T>,
    request: { readonly action: string; readonly args?: ActionArgs; readonly expect: string },
    options: VrcLookupOptions | undefined,
  ): Promise<T> {
    const value = mirror.value;
    if (value !== undefined && options?.cached !== false) return value;
    return this.#shared(`${request.action}:${JSON.stringify(request.args ?? {})}`, () =>
      this.#deps.channel.request<T>({
        ...request,
        swallow: false,
        accept: (payload) => mirror.read(payload),
      }),
      options?.signal,
    );
  }

  /**
   * One in-flight request per key; identical concurrent calls share the answer.
   *
   * The shared request itself runs unsignalled: whoever started it must not be able to cancel it
   * for everyone else. Each caller races its own signal instead, so an abort rejects that caller
   * alone and the request carries on for the rest (it ends at the channel's own timeout).
   */
  #shared<T>(key: string, start: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    signal?.throwIfAborted();
    let pending = this.#inFlight.get(key) as Promise<T> | undefined;
    if (pending === undefined) {
      pending = start().finally(() => { this.#inFlight.delete(key); });
      this.#inFlight.set(key, pending);
    }
    return signal === undefined ? pending : raceSignal(pending, signal);
  }

  /**
   * A quiet lookup of one record, remembered for {@link DETAIL_TTL_MS}.
   *
   * reuse: a whole record, which no page cache holds. VRCNext caches *names* for the things its
   * screens have shown — `ctx.vrchat.name` reads those for free — but a world's author, an
   * avatar's ranks or a user's meet count are only in the reply. Prefer `name` when the name is
   * all that is wanted; this is for when it is not.
   */
  async #detail<T>(
    key: string,
    request: { readonly action: string; readonly args: ActionArgs; readonly expect: string; readonly swallow?: boolean; accept(payload: unknown): T | undefined },
    options: VrcLookupOptions | undefined,
  ): Promise<T> {
    const cached = this.#details.get(key);
    if (cached !== undefined) {
      this.#details.delete(key);
      if (options?.cached !== false && this.#now() - cached.at < DETAIL_TTL_MS) {
        // Re-inserted so the map's order is least recently used first.
        this.#details.set(key, cached);
        return cached.value as T;
      }
    }
    return this.#shared(key, async () => {
      const value = await this.#deps.channel.request<T>(request);
      this.#details.set(key, { at: this.#now(), value });
      while (this.#details.size > DETAIL_MAX_ENTRIES) {
        const oldest = this.#details.keys().next();
        if (oldest.done === true) break;
        this.#details.delete(oldest.value);
      }
      return value;
    }, options?.signal);
  }

  /** A lookup whose absence is an answer: a timeout or refusal becomes `undefined`. */
  async #optional<T>(lookup: Promise<T>): Promise<T | undefined> {
    try {
      return await lookup;
    } catch {
      return undefined;
    }
  }

  /**
   * The signed-in account.
   *
   * VRCNext pushes `vrcUser` once, when it signs in. A host that finished starting after that
   * — which is the usual case, since it loads its plugins from the bridge first — never sees
   * the message and would answer `undefined` for the rest of the session. The page keeps that
   * same payload in `currentVrcUser`, so it is read once as a fallback.
   */
  self(): VrcSelf | undefined {
    if (this.#self === undefined) this.#self = n.self(pageGlobal('currentVrcUser'));
    return this.#self;
  }

  friends(options?: VrcLookupOptions): Promise<readonly VrcUserSummary[]> {
    return this.#list(this.#friends, { action: 'vrcRefreshFriends', expect: 'vrcFriends' }, options);
  }

  async favoriteFriends(options?: VrcLookupOptions): Promise<readonly VrcUserSummary[]> {
    const [ids, friends] = await Promise.all([
      this.#list(this.#favoriteFriendIds, { action: 'vrcGetFavoriteFriends', expect: 'vrcFavoriteFriends' }, options),
      this.friends(options),
    ]);
    const byId = new Map(friends.map((f) => [f.id, f]));
    return ids.flatMap((id) => {
      const friend = byId.get(id);
      return friend === undefined ? [] : [friend];
    });
  }

  /** The groups, with each member resolved to a name where this page knows one. */
  async favoriteFriendGroups(options?: VrcLookupOptions): Promise<readonly VrcFavoriteGroup[]> {
    const [groups, friends] = await Promise.all([
      this.#list(this.#favoriteGroups, { action: 'vrcGetFavoriteFriends', expect: 'vrcFavoriteFriends' }, options),
      this.friends(options),
    ]);
    const byId = new Map(friends.map((f) => [f.id, f]));
    return groups.map((group) => ({
      ...group,
      users: group.userIds.flatMap((id) => {
        const user = byId.get(id);
        return user === undefined ? [] : [user];
      }),
    }));
  }

  /**
   * How many people are on each of your moderation lists.
   *
   * Counted from the page's own arrays, which VRCNext loads once every two hours and patches on
   * every block and unblock. The pushes are mirrored too, so a count stays right either way;
   * the page is what makes the first call free. Asking instead would mean
   * `vrcGetAllModerations` — five uncached `GET /auth/user/playermoderations` calls — to count
   * rows already in memory.
   */
  moderationCounts(): VrcModerationCounts {
    const lists = pageModerationLists();
    return {
      blocked: lists.block?.length ?? 0,
      muted: lists.mute?.length ?? 0,
      hiddenAvatar: lists.hideAvatar?.length ?? 0,
      interactOff: lists.interactOff?.length ?? 0,
      muteChat: lists.muteChat?.length ?? 0,
    };
  }

  recentPlayers(options?: VrcLookupOptions): Promise<readonly VrcUserSummary[]> {
    return this.#list(this.#recentPlayers, { action: 'vrcGetRecentSeen', expect: 'recentSeenPlayers' }, options);
  }

  favoriteWorlds(options?: VrcLookupOptions): Promise<readonly VrcWorldSummary[]> {
    return this.#list(this.#favoriteWorlds, { action: 'vrcGetFavoriteWorlds', expect: 'vrcFavoriteWorlds' }, options);
  }

  recentWorlds(options?: VrcLookupOptions): Promise<readonly VrcWorldSummary[]> {
    return this.#list(this.#recentWorlds, { action: 'vrcGetVisitedWorlds', expect: 'visitedWorlds' }, options);
  }

  ownAvatars(options?: VrcLookupOptions): Promise<readonly VrcAvatarSummary[]> {
    return this.#list(this.#ownAvatars, { action: 'vrcGetAvatars', args: { filter: 'own' }, expect: 'vrcAvatars' }, options);
  }

  favoriteAvatars(options?: VrcLookupOptions): Promise<readonly VrcAvatarSummary[]> {
    return this.#list(this.#favoriteAvatars, { action: 'vrcGetAvatars', args: { filter: 'favorites' }, expect: 'vrcFavoriteAvatars' }, options);
  }

  recentAvatars(options?: VrcLookupOptions): Promise<readonly VrcAvatarSummary[]> {
    return this.#list(this.#recentAvatars, { action: 'vrcGetRecentAvatars', expect: 'recentAvatars' }, options);
  }

  myGroups(options?: VrcLookupOptions): Promise<readonly VrcGroupSummary[]> {
    return this.#list(this.#myGroups, { action: 'vrcGetMyGroups', expect: 'vrcMyGroups' }, options);
  }

  async currentInstance(options?: VrcLookupOptions): Promise<VrcInstance | undefined> {
    const answer = await this.#list(this.#instance, { action: 'vrcGetCurrentInstance', expect: 'vrcCurrentInstance' }, options);
    return answer.instance;
  }

  async friendInstances(options?: VrcLookupOptions): Promise<readonly VrcFriendInstance[]> {
    const friends = await this.friends(options);
    const worlds = new Map<string, string>();
    for (const world of [...(this.#favoriteWorlds.value ?? []), ...(this.#recentWorlds.value ?? [])]) {
      worlds.set(world.id, world.name);
    }
    const byLocation = new Map<string, VrcUserSummary[]>();
    for (const friend of friends) {
      if (!friend.location.startsWith('wrld_')) continue;
      const group = byLocation.get(friend.location) ?? [];
      group.push(friend);
      byLocation.set(friend.location, group);
    }
    return [...byLocation].map(([location, members]) => {
      const shape = n.instance({ location });
      return {
        location,
        worldId: shape?.worldId ?? '',
        // Favourites and recents first, then the name cache VRCNext's own screens filled: a
        // friend standing in a world the user has never favourited is the common case, and it
        // is not worth a world lookup per group of friends to name it.
        worldName: firstNonEmpty(worlds.get(shape?.worldId ?? ''), pageName('world', shape?.worldId ?? '')),
        instanceType: shape?.instanceType ?? '',
        friends: members,
      };
    });
  }

  user(id: string, options?: VrcLookupOptions): Promise<VrcUser | undefined> {
    return this.#optional(this.#detail(`user:${id}`, {
      action: 'vrcGetFriendDetail',
      args: { userId: id },
      expect: 'vrcFriendDetail',
      accept: (p) => {
        const user = n.userDetail(p);
        return user?.id === id ? user : undefined;
      },
    }, options));
  }

  async userBasic(id: string, options?: VrcLookupOptions): Promise<VrcUserSummary | undefined> {
    const known = this.#friends.value?.find((f) => f.id === id);
    if (known !== undefined && options?.cached !== false) return known;
    return this.#optional(this.#detail(`userBasic:${id}`, {
      action: 'vrcGetUserBasic',
      args: { userId: id, contextId: 'vrcnext-plugins' },
      expect: 'vrcUserBasic',
      accept: (p) => {
        const user = n.userSummary(p);
        return user?.id === id ? user : undefined;
      },
    }, { ...options, cached: options?.cached ?? true }));
  }

  async userGroups(id: string, options?: VrcLookupOptions): Promise<readonly VrcGroupSummary[]> {
    const groups = await this.#optional(this.#detail(`userGroups:${id}`, {
      action: 'vrcGetGroupsForNetwork',
      args: { userId: id },
      expect: 'vrcGroupsForNetwork',
      accept: (p) => {
        const r = n.rec(p);
        return r !== undefined && n.str(r['userId']) === id ? n.each(r['groups'], n.groupSummary) : undefined;
      },
    }, options));
    // VRCNext answers with ids and member counts only; names come from what else it told us —
    // the groups the account is in, and the name cache its dashboard fills.
    const named = new Map((this.#myGroups.value ?? []).map((g) => [g.id, g]));
    return (groups ?? []).map((g) => ({
      ...g,
      // Empty strings are what VRCNext sends for "not resolved", so each fallback is tried on
      // emptiness rather than on nullishness.
      name: firstNonEmpty(g.name, named.get(g.id)?.name, pageName('group', g.id)),
      iconUrl: g.iconUrl || (named.get(g.id)?.iconUrl ?? ''),
    }));
  }

  async userTimeline(id: string, options?: VrcLookupOptions): Promise<readonly VrcTimelineEvent[]> {
    const events = await this.#optional(this.#detail(`timeline:${id}`, {
      action: 'getTimelineForUser',
      args: { userId: id },
      expect: 'timelineForUser',
      accept: (p) => {
        const r = n.rec(p);
        return r !== undefined && n.str(r['userId']) === id ? n.each(r['events'], n.timelineEvent) : undefined;
      },
    }, options));
    return events ?? [];
  }

  /**
   * What you have done to this player: blocked, muted, chat-muted, avatar hidden, interactions
   * off.
   *
   * No request, and no copy of the data. These five lists belong to the signed-in account
   * rather than to the player being looked up, and VRCNext already holds them in the page: it
   * reads them once every two hours and patches them in place on every block and unblock. This
   * reads the same arrays its own profile card reads, so the answer is exactly what the app
   * would show and a block made a second ago is already in it. See `page-state.ts`.
   *
   * Synchronous for the same reason: there is nothing to wait for. A list VRCNext has not
   * loaded leaves its field `undefined` rather than `false` — a report has to be able to say
   * "could not be checked" instead of quietly clearing someone.
   */
  moderations(id: string): VrcModerations {
    const lists = pageModerationLists();
    const has = (list: readonly string[] | undefined): boolean | undefined =>
      list === undefined ? undefined : list.includes(id);
    return {
      blocked: has(lists.block),
      muted: has(lists.mute),
      chatMuted: has(lists.muteChat),
      avatarHidden: has(lists.hideAvatar),
      interactOff: has(lists.interactOff),
    };
  }

  /**
   * How long they spent in each status over the last `days`.
   *
   * VRCNext answers this from its own database, so it costs no VRChat request, and the reply is
   * not swallowed: it is harmless for the app to see its own numbers refresh.
   */
  statusTime(id: string, days = 30, options?: VrcLookupOptions): Promise<VrcStatusTime | undefined> {
    return this.#optional(this.#detail(`statusTime:${id}:${String(days)}`, {
      action: 'getUserStatusTime',
      args: { userId: id, days },
      expect: 'userStatusTime',
      accept: (payload) => {
        const r = n.rec(payload);
        return r !== undefined && n.str(r['userId']) === id ? n.statusTime(payload) : undefined;
      },
      swallow: false,
    }, options));
  }

  instanceAvatar(userId: string, options?: VrcLookupOptions): Promise<{ readonly avatarId: string; readonly avatarName: string } | undefined> {
    return this.#optional(this.#detail(`instanceAvatar:${userId}`, {
      action: 'vrcGetInstanceAvatars',
      args: { userIds: [userId] },
      expect: 'vrcInstanceAvatarFound',
      accept: (p) => {
        const r = n.rec(p);
        if (r === undefined || n.str(r['userId']) !== userId) return undefined;
        return { avatarId: n.str(r['avatarId']), avatarName: n.str(r['avatarName']) };
      },
    }, options));
  }

  /** A name VRCNext has already resolved. See `page-state.ts`; this is a read, not a lookup. */
  name(kind: 'world' | 'avatar' | 'group', id: string): string | undefined {
    const cached = pageName(kind, id);
    if (cached !== undefined) return cached;
    // The groups the account is in are a name source of their own, and the mirror may hold them
    // when the dashboard has not drawn them yet.
    if (kind === 'group') {
      const mine = this.#myGroups.value?.find((group) => group.id === id)?.name;
      return mine === undefined || mine === '' ? undefined : mine;
    }
    return undefined;
  }

  avatar(id: string, options?: VrcLookupOptions): Promise<VrcAvatar | undefined> {
    return this.#optional(this.#detail(`avatar:${id}`, {
      action: 'vrcGetAvatarDetail',
      args: { avatarId: id },
      expect: 'vrcAvatarDetail',
      accept: (p) => {
        const avatar = n.avatarDetail(p);
        return avatar?.id === id ? avatar : undefined;
      },
    }, options));
  }

  world(id: string, options?: VrcLookupOptions): Promise<VrcWorld | undefined> {
    return this.#optional(this.#detail(`world:${id}`, {
      action: 'vrcGetWorldDetail',
      args: { worldId: id },
      expect: 'vrcWorldDetail',
      accept: (p) => {
        const world = n.worldDetail(p);
        return world?.id === id ? world : undefined;
      },
    }, options));
  }

  group(id: string, options?: VrcLookupOptions): Promise<VrcGroup | undefined> {
    return this.#optional(this.#detail(`group:${id}`, {
      action: 'vrcGetGroup',
      args: { groupId: id },
      expect: 'vrcGroupDetail',
      accept: (p) => {
        const group = n.groupDetail(p);
        return group?.id === id ? group : undefined;
      },
    }, options));
  }

  /** `vrcSearchResults` carries `type`, `results`, `offset` and `hasMore` for every kind. */
  #search<T>(
    kind: { readonly type: 'users' | 'worlds' | 'groups'; readonly action: string; read(item: unknown): T | undefined },
    args: ActionArgs,
    options: VrcSearchOptions | undefined,
  ): Promise<VrcSearchPage<T>> {
    const offset = options?.offset ?? 0;
    return this.#deps.channel.request<VrcSearchPage<T>>({
      action: kind.action,
      args: { ...args, offset },
      expect: 'vrcSearchResults',
      accept: (p) => {
        const r = n.rec(p);
        if (r === undefined) return undefined;
        if (r['type'] !== kind.type || (r['offset'] ?? 0) !== offset) return undefined;
        return { results: n.each(r['results'], (item) => kind.read(item)), offset, hasMore: r['hasMore'] === true };
      },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  searchUsers(query: string, options?: VrcSearchOptions): Promise<VrcSearchPage<VrcUserSummary>> {
    return this.#search({ type: 'users', action: 'vrcSearchUsers', read: n.userSummary }, { query }, options);
  }

  searchWorlds(query: string, options?: VrcSearchOptions & { readonly sort?: string }): Promise<VrcSearchPage<VrcWorldSummary>> {
    return this.#search({ type: 'worlds', action: 'vrcSearchWorlds', read: n.worldSummary }, { query, sort: options?.sort ?? 'relevance' }, options);
  }

  searchGroups(query: string, options?: VrcSearchOptions): Promise<VrcSearchPage<VrcGroupSummary>> {
    return this.#search({ type: 'groups', action: 'vrcSearchGroups', read: n.groupSummary }, { query }, options);
  }

  searchAvatars(query: string, options?: VrcSearchOptions): Promise<VrcSearchPage<VrcAvatarSummary>> {
    const offset = options?.offset ?? 0;
    const page = Math.floor(offset / SEARCH_PAGE);
    return this.#deps.channel.request<VrcSearchPage<VrcAvatarSummary>>({
      action: 'vrcSearchAvatars',
      args: { query, page, db: 'avtrdb' },
      expect: 'vrcAvatarSearchResults',
      accept: (p) => {
        const r = n.rec(p);
        if (r === undefined) return undefined;
        if ((r['page'] ?? 0) !== page) return undefined;
        return { results: n.each(r['results'], n.avatarSummary), offset: page * SEARCH_PAGE, hasMore: r['hasMore'] === true };
      },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  async originalImageUrl(subject: ImageSubject, options?: VrcLookupOptions): Promise<string> {
    const key = imageCacheKeyFor(subject);
    const resolve = this.#deps.resolveImage;
    if (key === undefined || resolve === undefined) return '';
    const cached = this.#images.get(key);
    if (cached !== undefined) {
      // Re-inserted so the map's order stays least recently used first.
      this.#images.delete(key);
      this.#images.set(key, cached);
      return cached;
    }
    if (options?.signal?.aborted === true) return '';
    let answer = '';
    try {
      answer = await resolve(key);
    } catch {
      // A picture is never worth failing a report over: the field drops instead.
      return '';
    }
    // Checked rather than trusted, whatever the database holds: this address is about to be handed
    // to something off this machine, and a cache URL there fails silently.
    const url = publicImageUrl(answer);
    if (url === '') return '';
    this.#images.set(key, url);
    while (this.#images.size > IMAGE_MAX_ENTRIES) {
      const oldest = this.#images.keys().next();
      if (oldest.done === true) break;
      this.#images.delete(oldest.value);
    }
    return url;
  }
}
