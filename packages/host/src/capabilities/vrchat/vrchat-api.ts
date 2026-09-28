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

import type {
  ActionArgs,
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
  VrcUser,
  VrcUserSummary,
  VrcWorld,
  VrcWorldSummary,
  VrchatApi,
} from '@vrcnext/plugin-api';

import type { EventRouter } from '../../events/event-router.js';
import * as n from './normalise.js';
import { pageGlobal } from './page-global.js';
import type { QuietChannel } from './quiet-channel.js';

/** How long a detail answer is reused. Long enough for a settings card to draw, short enough to notice a status change. */
const DETAIL_TTL_MS = 60_000;
const SEARCH_PAGE = 20;

interface Cached<T> {
  readonly at: number;
  readonly value: T;
}

/** A list VRCNext pushes: the last payload seen, and how to ask for it again. */
class Mirror<T> {
  #value: T | undefined;
  readonly #read: (payload: unknown) => T | undefined;

  constructor(read: (payload: unknown) => T | undefined) {
    this.#read = read;
  }

  /** Feeds a push; returns whether it was this list. */
  feed(payload: unknown): boolean {
    const value = this.#read(payload);
    if (value === undefined) return false;
    this.#value = value;
    return true;
  }

  get value(): T | undefined {
    return this.#value;
  }

  read(payload: unknown): T | undefined {
    return this.#read(payload);
  }
}

export interface VrchatApiDeps {
  readonly router: EventRouter;
  readonly channel: QuietChannel;
  readonly now?: () => number;
}

export class HostVrchatApi implements VrchatApi {
  readonly #deps: VrchatApiDeps;
  readonly #unsubscribe: (() => void)[] = [];
  #self: VrcSelf | undefined;

  readonly #friends = new Mirror<readonly VrcUserSummary[]>((p) => {
    const r = n.rec(p);
    const raw = r !== undefined && Array.isArray(r['friends']) ? r['friends'] : Array.isArray(p) ? p : undefined;
    return raw === undefined ? undefined : n.each(raw, n.friendSummary);
  });
  readonly #favoriteFriendIds = new Mirror<readonly string[]>(n.favoriteFriendIds);
  readonly #favoriteGroups = new Mirror<readonly VrcFavoriteGroup[]>(n.favoriteGroups);
  /** One mirror per moderation list; VRCNext pushes them as five separate events. */
  readonly #moderations = new Map<keyof VrcModerationCounts, number>();
  readonly #recentPlayers = new Mirror<readonly VrcUserSummary[]>((p) => {
    const players = n.rec(p)?.['players'];
    return Array.isArray(players) ? n.each(players, n.userSummary) : undefined;
  });
  readonly #favoriteWorlds = new Mirror<readonly VrcWorldSummary[]>((p) => {
    const worlds = n.rec(p)?.['worlds'];
    return Array.isArray(worlds) ? n.each(worlds, n.worldSummary) : undefined;
  });
  readonly #recentWorlds = new Mirror<readonly VrcWorldSummary[]>((p) => {
    const worlds = n.rec(p)?.['worlds'];
    return Array.isArray(worlds) ? n.each(worlds, n.worldSummary) : undefined;
  });
  readonly #ownAvatars = new Mirror<readonly VrcAvatarSummary[]>((p) => {
    const r = n.rec(p);
    return r?.['filter'] === 'own' && Array.isArray(r['avatars']) ? n.each(r['avatars'], n.avatarSummary) : undefined;
  });
  readonly #favoriteAvatars = new Mirror<readonly VrcAvatarSummary[]>((p) => {
    const avatars = n.rec(p)?.['avatars'];
    return Array.isArray(avatars) ? n.each(avatars, n.avatarSummary) : undefined;
  });
  readonly #recentAvatars = new Mirror<readonly VrcAvatarSummary[]>((p) => {
    const avatars = n.rec(p)?.['avatars'];
    return Array.isArray(avatars) ? n.each(avatars, n.avatarSummary) : undefined;
  });
  readonly #myGroups = new Mirror<readonly VrcGroupSummary[]>((p) =>
    Array.isArray(p) ? n.each(p, (g) => {
      const group = n.groupSummary(g);
      return group === undefined ? undefined : { ...group, isJoined: true };
    }) : undefined,
  );
  /** `{ instance }` so "not in an instance" is a known answer rather than an empty mirror. */
  readonly #instance = new Mirror<{ readonly instance: VrcInstance | undefined }>((p) =>
    n.rec(p) === undefined ? undefined : { instance: n.instance(p) },
  );

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
    const moderation: readonly (readonly [string, keyof VrcModerationCounts])[] = [
      ['vrcBlockedList', 'blocked'],
      ['vrcMutedList', 'muted'],
      ['vrcHideAvatarList', 'hiddenAvatar'],
      ['vrcInteractOffList', 'interactOff'],
      ['vrcMuteChatList', 'muteChat'],
    ];
    for (const [event, key] of moderation) {
      on(event, (p) => {
        if (Array.isArray(p)) this.#moderations.set(key, p.length);
      });
    }
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
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  /** One in-flight request per key; identical concurrent calls share the answer. */
  #shared<T>(key: string, start: () => Promise<T>): Promise<T> {
    const pending = this.#inFlight.get(key);
    if (pending !== undefined) return pending as Promise<T>;
    const promise = start().finally(() => { this.#inFlight.delete(key); });
    this.#inFlight.set(key, promise);
    return promise;
  }

  /** A quiet lookup, remembered for {@link DETAIL_TTL_MS}. */
  async #detail<T>(
    key: string,
    request: { readonly action: string; readonly args: ActionArgs; readonly expect: string; accept(payload: unknown): T | undefined },
    options: VrcLookupOptions | undefined,
  ): Promise<T> {
    const cached = this.#details.get(key);
    if (cached !== undefined && options?.cached !== false && this.#now() - cached.at < DETAIL_TTL_MS) {
      return cached.value as T;
    }
    return this.#shared(key, async () => {
      const value = await this.#deps.channel.request<T>({
        ...request,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      this.#details.set(key, { at: this.#now(), value });
      return value;
    });
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
   * One request fans out into five list pushes, so this waits for the blocked list and reads
   * whatever the others left behind — they arrive together.
   */
  async moderationCounts(options?: VrcLookupOptions): Promise<VrcModerationCounts> {
    const known = (): VrcModerationCounts => ({
      blocked: this.#moderations.get('blocked') ?? 0,
      muted: this.#moderations.get('muted') ?? 0,
      hiddenAvatar: this.#moderations.get('hiddenAvatar') ?? 0,
      interactOff: this.#moderations.get('interactOff') ?? 0,
      muteChat: this.#moderations.get('muteChat') ?? 0,
    });
    if (this.#moderations.size > 0 && options?.cached !== false) return known();
    await this.#shared('vrcGetAllModerations', () =>
      this.#deps.channel.request<number>({
        action: 'vrcGetAllModerations',
        expect: 'vrcBlockedList',
        swallow: false,
        accept: (payload) => (Array.isArray(payload) ? payload.length : undefined),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
    return known();
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
        worldName: worlds.get(shape?.worldId ?? '') ?? '',
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
    // VRCNext answers with ids and member counts only; names come from what else it told us.
    const named = new Map((this.#myGroups.value ?? []).map((g) => [g.id, g]));
    return (groups ?? []).map((g) => ({ ...g, name: g.name || (named.get(g.id)?.name ?? ''), iconUrl: g.iconUrl || (named.get(g.id)?.iconUrl ?? '') }));
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
}
