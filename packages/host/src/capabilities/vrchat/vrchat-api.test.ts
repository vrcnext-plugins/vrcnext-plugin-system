/**
 * The VRChat API over a scripted VRCNext: its page globals are the lists, and lookups go through
 * a fake quiet channel that answers from a table of replies.
 *
 * `page()` is how a test says "VRCNext has this loaded". There is no push to feed any more — the
 * host keeps no copy — so a list is either in the page or it is asked for.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { EventRouter } from '../../events/event-router.js';
import type { QuietChannel, QuietRequest } from './quiet-channel.js';
import { HostVrchatApi } from './vrchat-api.js';

const USER = 'usr_12345678-1234-1234-1234-123456789abc';
const WORLD = 'wrld_12345678-1234-1234-1234-123456789abc';

interface Fake {
  readonly api: HostVrchatApi;
  readonly router: EventRouter;
  readonly requests: QuietRequest<unknown>[];
  /** Replies by event type; a request is answered with the first payload its `accept` takes. */
  readonly replies: Map<string, unknown[]>;
}

function fake(resolveImage?: (key: string) => Promise<string>): Fake {
  const router = new EventRouter();
  const requests: QuietRequest<unknown>[] = [];
  const replies = new Map<string, unknown[]>();
  const channel = {
    request: <T>(request: QuietRequest<T>): Promise<T> => {
      requests.push(request);
      for (const payload of replies.get(request.expect) ?? []) {
        const value = request.accept(payload);
        if (value !== undefined) return Promise.resolve(value);
      }
      return Promise.reject(new Error(`no reply for ${request.expect}`));
    },
  } as QuietChannel;
  const api = new HostVrchatApi(
    resolveImage === undefined ? { router, channel } : { router, channel, resolveImage },
  );
  return { api, router, requests, replies };
}

/** Sets VRCNext's own globals for one test, and clears them afterwards. */
function page(values: Record<string, unknown>, body: () => Promise<void> | void): Promise<void> | void {
  const g = globalThis as Record<string, unknown>;
  const restore = Object.keys(values).map((key) => [key, g[key]] as const);
  Object.assign(g, values);
  const done = (): void => { for (const [key, old] of restore) g[key] = old; };
  try {
    const result = body();
    return result instanceof Promise ? result.finally(done) : (done(), undefined);
  } catch (error) {
    done();
    throw error;
  }
}

test('a list the page has not loaded is asked for; one it has is read, not asked', async () => {
  const f = fake();
  f.replies.set('vrcMyGroups', [[{ id: 'grp_1', name: 'Club', memberCount: 3 }]]);
  const asked = await f.api.myGroups();
  assert.deepEqual(asked.map((g) => [g.id, g.name, g.isJoined]), [['grp_1', 'Club', true]]);
  const first = f.requests[0];
  assert.ok(first !== undefined);
  assert.equal(first.action, 'vrcGetMyGroups');
  assert.equal(first.swallow, false, 'list replies are VRCNext’s to handle too');

  const location = `${WORLD}:1~region(eu)`;
  await page({
    vrcFriendsData: [{ id: USER, displayName: 'Tupper', image: 'i', status: 'active', location }],
    vrcFriendsLoaded: true,
  }, async () => {
    const friend = (await f.api.friends())[0];
    assert.ok(friend !== undefined);
    assert.equal(friend.displayName, 'Tupper');
    assert.equal(friend.isFriend, true);
    assert.equal(f.requests.length, 1, 'no request for a list the page holds');

    const instances = await f.api.friendInstances();
    assert.deepEqual(instances.map((i) => [i.worldId, i.instanceType, i.friends.length]), [[WORLD, 'public', 1]]);
  });
});

test('self comes from the vrcUser push and is synchronous', () => {
  const f = fake();
  assert.equal(f.api.self(), undefined);
  f.router.dispatch({
    type: 'vrcUser',
    payload: { id: USER, displayName: 'Me', image: '', status: 'active', bio: 'hi', bioLinks: ['https://x.test'], pronouns: 'they/them', dateJoined: '2020-01-01', vrcRunning: true },
  });
  const me = f.api.self();
  assert.ok(me !== undefined);
  assert.equal(me.displayName, 'Me');
  assert.deepEqual([me.bio, me.pronouns, me.dateJoined, me.vrcRunning], ['hi', 'they/them', '2020-01-01', true]);
  assert.deepEqual(me.bioLinks, ['https://x.test']);
});

test('favourite groups keep their names and resolve members this page knows', async () => {
  const f = fake();
  await page({
    vrcFriendsData: [{ id: USER, displayName: 'Tupper', image: '' }],
    vrcFriendsLoaded: true,
    favFriendsData: [{ favoriteId: USER, groupName: 'group_0' }, { favoriteId: 'usr_stranger', groupName: 'group_0' }],
    favFriendGroups: [{ name: 'group_0', displayName: 'Besties' }, { name: 'group_1', displayName: 'Others' }],
    _pplFavLoaded: true,
  }, async () => {
    const groups = await f.api.favoriteFriendGroups();
    assert.deepEqual(groups.map((g) => [g.name, g.displayName, g.userIds.length, g.users.map((u) => u.displayName)]), [
      ['group_0', 'Besties', 2, ['Tupper']],
      ['group_1', 'Others', 0, []],
    ]);
  });
});

test('moderation counts are read from the page, never requested and never mirrored', () => {
  const f = fake();
  assert.deepEqual(f.api.moderationCounts(), { blocked: 0, muted: 0, hiddenAvatar: 0, interactOff: 0, muteChat: 0 },
    'nothing in the page: zero, and no action sent');
  assert.deepEqual(f.requests, [], 'counting rows VRCNext already holds is not worth five VRChat calls');

  // The page is the only copy: VRCNext loads these once every two hours and patches them on
  // every block, so a mirror of the counts could only ever be the same numbers or staler ones.
  (globalThis as Record<string, unknown>)['blockedData'] = [{ targetUserId: 'usr_a' }, { targetUserId: 'usr_b' }];
  (globalThis as Record<string, unknown>)['mutedData'] = [{ targetUserId: 'usr_c' }];
  try {
    assert.deepEqual(f.api.moderationCounts(), { blocked: 2, muted: 1, hiddenAvatar: 0, interactOff: 0, muteChat: 0 });
    assert.deepEqual(f.requests, []);
  } finally {
    (globalThis as Record<string, unknown>)['blockedData'] = undefined;
    (globalThis as Record<string, unknown>)['mutedData'] = undefined;
  }
});

test('details are asked quietly, matched by id, and cached', async () => {
  const f = fake();
  f.replies.set('vrcFriendDetail', [{ id: 'usr_other' }, { id: USER, displayName: 'Tupper', ageVerified: true, ageVerificationStatus: '18+', userGroups: [{ id: 'grp_1', name: 'Club' }] }]);
  const user = await f.api.user(USER);
  assert.ok(user !== undefined);
  assert.equal(user.displayName, 'Tupper');
  assert.equal(user.ageVerified, true);
  assert.equal(user.groups[0]?.name, 'Club');
  assert.equal(f.requests[0]?.swallow, undefined, 'default: withheld from VRCNext');
  await f.api.user(USER);
  assert.equal(f.requests.length, 1, 'second lookup served from cache');
  await f.api.user(USER, { cached: false });
  assert.equal(f.requests.length, 2);
  assert.equal(await f.api.user('usr_unknown'), undefined, 'no answer is undefined, not a rejection');
});

test('avatar ranks come from VRCNext’s pcPerf/questPerf or the unity packages', async () => {
  const f = fake();
  f.replies.set('vrcAvatarDetail', [{ id: 'avtr_1', name: 'A', pcPerf: 'Good', questPerf: 'VeryPoor', hasPC: true }]);
  const avatar = await f.api.avatar('avtr_1');
  assert.deepEqual([avatar?.pcRank, avatar?.questRank, avatar?.iosRank, avatar?.hasPc], ['Good', 'VeryPoor', '', true]);
  await page({
    avatarsData: [{ id: 'avtr_2', name: 'B', unityPackages: [{ platform: 'standalonewindows', performanceRating: 'Medium' }, { platform: 'android', variant: 'impostor', performanceRating: 'Poor' }] }],
    avatarFilter: 'own',
    avatarsLoaded: true,
  }, async () => {
    const own = await f.api.ownAvatars();
    assert.deepEqual([own[0]?.pcRank, own[0]?.questRank], ['Medium', '']);
  });
});

test('the current instance is parsed, including the group and instance id', async () => {
  const f = fake();
  await page({
    currentInstanceData: { location: `${WORLD}:60529~group(grp_1)~groupAccessType(plus)~region(eu)`, worldName: 'Club', instanceType: 'group-plus', nUsers: 2, users: [{ id: USER, displayName: 'Tupper' }, { id: '', displayName: 'Legacy' }] },
  }, async () => {
    const instance = await f.api.currentInstance();
    assert.deepEqual([instance?.instanceId, instance?.groupId, instance?.region, instance?.users.length], ['60529', 'grp_1', 'eu', 2]);
  });
  await page({ currentInstanceData: { empty: true } }, async () => {
    assert.equal(await f.api.currentInstance(), undefined);
  });
});

test('searches match on type and offset', async () => {
  const f = fake();
  f.replies.set('vrcSearchResults', [
    { type: 'worlds', results: [{ id: WORLD }], offset: 0, hasMore: false },
    { type: 'users', results: [{ id: USER, displayName: 'Tupper', isFriend: true }], offset: 20, hasMore: true },
  ]);
  const page = await f.api.searchUsers('tup', { offset: 20 });
  assert.deepEqual([page.results[0]?.displayName, page.hasMore, page.offset], ['Tupper', true, 20]);
  assert.deepEqual(f.requests[0]?.args, { query: 'tup', offset: 20 });
});

test('user groups are named from your own groups when VRCNext only gives ids', async () => {
  const f = fake();
  f.replies.set('vrcGroupsForNetwork', [{ userId: USER, groups: [{ id: 'grp_1', members: 5 }, { id: 'grp_2', members: 1 }] }]);
  await page({ myGroups: [{ id: 'grp_1', name: 'Club', iconUrl: 'x' }], myGroupsLoaded: true }, async () => {
    const groups = await f.api.userGroups(USER);
    assert.deepEqual(groups.map((g) => [g.id, g.name, g.memberCount]), [['grp_1', 'Club', 5], ['grp_2', '', 1]]);
  });
});

test('a shared lookup is not cancelled by the caller that started it', async () => {
  const router = new EventRouter();
  const requests: QuietRequest<unknown>[] = [];
  let answer: (payload: unknown) => void = () => undefined;
  const channel = {
    request: <T>(request: QuietRequest<T>): Promise<T> => {
      requests.push(request);
      return new Promise<T>((resolve) => { answer = (payload) => { resolve(request.accept(payload) as T); }; });
    },
  } as QuietChannel;
  const api = new HostVrchatApi({ router, channel });
  const controller = new AbortController();
  const first = api.world(WORLD, { signal: controller.signal });
  const second = api.world(WORLD);
  assert.equal(requests.length, 1, 'identical lookups share one request');
  assert.equal(requests[0]?.signal, undefined, 'the shared request carries no caller’s signal');
  controller.abort();
  assert.equal(await first, undefined, 'the aborted caller is let go at once, as any lookup that got no answer');
  answer({ id: WORLD, name: 'Home' });
  assert.equal((await second)?.name, 'Home');
});

test('the detail cache is bounded, dropping the least recently used', async () => {
  const f = fake();
  const ids = Array.from({ length: 201 }, (_, i) => `usr_${String(i).padStart(8, '0')}-1234-1234-1234-123456789abc`);
  f.replies.set('vrcFriendDetail', ids.map((id) => ({ id, displayName: id })));
  for (const id of ids.slice(0, 200)) await f.api.user(id);
  await f.api.user(ids[0] ?? '');
  assert.equal(f.requests.length, 200, 'a recent entry is served from cache');
  await f.api.user(ids[200] ?? '');
  await f.api.user(ids[0] ?? '');
  assert.equal(f.requests.length, 201, 'the most recently used entry survived the eviction');
  await f.api.user(ids[1] ?? '');
  assert.equal(f.requests.length, 202, 'the least recently used entry was evicted');
});

test('a picture is resolved by entity, checked, and cached — but an absence is not', async () => {
  const asked: string[] = [];
  const stored: Record<string, string> = {
    'Users/usr_1': 'https://api.vrchat.cloud/api/1/image/file_a/1/800',
    'Avatars/avtr_1': 'https://api.vrchat.cloud/api/1/image/file_b/1/800',
    'Users/usr_1_pfp': 'https://api.vrchat.cloud/api/1/image/file_c/1/800',
    // What must never be handed out, whatever the database says.
    'Users/usr_local': 'http://localhost:51956/imgcache/Users/usr_local.png',
  };
  const f = fake((key) => { asked.push(key); return Promise.resolve(stored[key] ?? ''); });

  assert.equal(await f.api.originalImageUrl({ kind: 'user', id: 'usr_1' }), stored['Users/usr_1']);
  assert.equal(await f.api.originalImageUrl({ kind: 'avatar', id: 'avtr_1' }), stored['Avatars/avtr_1']);
  assert.equal(await f.api.originalImageUrl({ kind: 'user', id: 'usr_1', variant: 'pfp' }), stored['Users/usr_1_pfp']);
  assert.deepEqual(asked, ['Users/usr_1', 'Avatars/avtr_1', 'Users/usr_1_pfp'], 'keyed by entity, not by URL');

  await f.api.originalImageUrl({ kind: 'user', id: 'usr_1' });
  assert.equal(asked.length, 3, 'an answer is cached');

  assert.equal(await f.api.originalImageUrl({ kind: 'user', id: 'usr_local' }), '', 'a local address is refused');

  // An absence must not be cached: the picture VRCNext has not downloaded yet is exactly the one
  // a later report needs, and caching the miss would poison the whole session.
  assert.equal(await f.api.originalImageUrl({ kind: 'user', id: 'usr_nobody' }), '');
  assert.equal(await f.api.originalImageUrl({ kind: 'user', id: 'usr_nobody' }), '');
  assert.equal(asked.filter((key) => key === 'Users/usr_nobody').length, 2, 'asked again, not remembered');
});

test('a picture answers empty rather than failing the caller', async () => {
  // No resolver: no bridge on this page.
  assert.equal(await fake().api.originalImageUrl({ kind: 'user', id: 'usr_1' }), '');

  // A resolver that throws — the bridge went away mid-report.
  const broken = fake(() => Promise.reject(new Error('not paired')));
  assert.equal(await broken.api.originalImageUrl({ kind: 'avatar', id: 'avtr_1' }), '');

  // An id that is not one.
  const f = fake(() => Promise.resolve('https://api.vrchat.cloud/api/1/image/file_a/1/800'));
  assert.equal(await f.api.originalImageUrl({ kind: 'user', id: '../../etc/passwd' }), '');

  // An aborted caller is let go without a lookup.
  const controller = new AbortController();
  controller.abort();
  const asked: string[] = [];
  const g = fake((key) => { asked.push(key); return Promise.resolve('https://api.vrchat.cloud/x'); });
  assert.equal(await g.api.originalImageUrl({ kind: 'user', id: 'usr_1' }, { signal: controller.signal }), '');
  assert.deepEqual(asked, []);
});

test('the page wins over a stale push, because VRCNext patches its own arrays', async () => {
  const f = fake();
  // A wholesale list push: what the mirror used to be the only record of.
  f.router.dispatch({ type: 'vrcFriends', payload: [{ id: 'usr_1', displayName: 'A', location: 'offline' }] });

  const g = globalThis as Record<string, unknown>;
  g['vrcFriendsData'] = [{ id: 'usr_1', displayName: 'A', location: 'wrld_1:5' }];
  g['vrcFriendsLoaded'] = true;
  try {
    // `vrcFriendUpdate` writes one friend straight into VRCNext's array and never sends a list,
    // so a mirror fed by pushes alone would still say "offline" here.
    assert.deepEqual((await f.api.friends()).map((u) => u.location), ['wrld_1:5']);
    assert.deepEqual(f.requests, [], 'and nothing was asked for');
  } finally {
    g['vrcFriendsData'] = undefined;
    g['vrcFriendsLoaded'] = undefined;
  }
});
