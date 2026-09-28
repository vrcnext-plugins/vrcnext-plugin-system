/**
 * The VRChat API over a scripted VRCNext: pushes feed the mirrors, lookups go through a fake
 * quiet channel that answers from a table of replies.
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

function fake(onReply?: (note: string) => void): Fake {
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
  const api = new HostVrchatApi(onReply === undefined ? { router, channel } : { router, channel, onReply });
  return { api, router, requests, replies };
}

test('lists answer from the mirror once VRCNext pushed them, and ask otherwise', async () => {
  const f = fake();
  f.replies.set('vrcMyGroups', [[{ id: 'grp_1', name: 'Club', memberCount: 3 }]]);
  const asked = await f.api.myGroups();
  assert.deepEqual(asked.map((g) => [g.id, g.name, g.isJoined]), [['grp_1', 'Club', true]]);
  const first = f.requests[0];
  assert.ok(first !== undefined);
  assert.equal(first.action, 'vrcGetMyGroups');
  assert.equal(first.swallow, false, 'list replies are VRCNext’s to handle too');
  const location = `${WORLD}:1~region(eu)`;

  f.router.dispatch({ type: 'vrcFriends', payload: { friends: [{ id: USER, displayName: 'Tupper', image: 'i', status: 'active', location }], counts: {} } });
  const friend = (await f.api.friends())[0];
  assert.ok(friend !== undefined);
  assert.equal(friend.displayName, 'Tupper');
  assert.equal(friend.isFriend, true);
  assert.equal(f.requests.length, 1, 'no request for a mirrored list');

  f.router.dispatch({ type: 'vrcFriendUpdate', payload: { id: USER, displayName: 'Tupper', status: 'busy', location } });
  assert.equal((await f.api.friends())[0]?.status, 'busy');

  const instances = await f.api.friendInstances();
  assert.deepEqual(instances.map((i) => [i.worldId, i.instanceType, i.friends.length]), [[WORLD, 'public', 1]]);
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
  f.router.dispatch({ type: 'vrcFriends', payload: { friends: [{ id: USER, displayName: 'Tupper', image: '' }] } });
  f.router.dispatch({
    type: 'vrcFavoriteFriends',
    payload: {
      friends: [{ favoriteId: USER, groupName: 'group_0' }, { favoriteId: 'usr_stranger', groupName: 'group_0' }],
      groups: [{ name: 'group_0', displayName: 'Besties' }, { name: 'group_1', displayName: 'Others' }],
    },
  });
  const groups = await f.api.favoriteFriendGroups();
  assert.deepEqual(groups.map((g) => [g.name, g.displayName, g.userIds.length, g.users.map((u) => u.displayName)]), [
    ['group_0', 'Besties', 2, ['Tupper']],
    ['group_1', 'Others', 0, []],
  ]);
});

test('moderation counts come from the five lists one request fans out into', async () => {
  const f = fake();
  f.replies.set('vrcBlockedList', [[{ id: 'a' }, { id: 'b' }]]);
  const counts = await f.api.moderationCounts();
  assert.equal(counts.blocked, 0, 'the fake channel answers without dispatching the pushes');
  f.router.dispatch({ type: 'vrcBlockedList', payload: [{ id: 'a' }, { id: 'b' }] });
  f.router.dispatch({ type: 'vrcMutedList', payload: [{ id: 'c' }] });
  assert.deepEqual(await f.api.moderationCounts(), { blocked: 2, muted: 1, hiddenAvatar: 0, interactOff: 0, muteChat: 0 });
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
  f.router.dispatch({ type: 'vrcAvatars', payload: { filter: 'own', avatars: [{ id: 'avtr_2', name: 'B', unityPackages: [{ platform: 'standalonewindows', performanceRating: 'Medium' }, { platform: 'android', variant: 'impostor', performanceRating: 'Poor' }] }] } });
  const own = await f.api.ownAvatars();
  assert.deepEqual([own[0]?.pcRank, own[0]?.questRank], ['Medium', '']);
});

test('the current instance is parsed, including the group and instance id', async () => {
  const f = fake();
  f.router.dispatch({ type: 'vrcCurrentInstance', payload: { location: `${WORLD}:60529~group(grp_1)~groupAccessType(plus)~region(eu)`, worldName: 'Club', instanceType: 'group-plus', nUsers: 2, users: [{ id: USER, displayName: 'Tupper' }, { id: '', displayName: 'Legacy' }] } });
  const instance = await f.api.currentInstance();
  assert.deepEqual([instance?.instanceId, instance?.groupId, instance?.region, instance?.users.length], ['60529', 'grp_1', 'eu', 2]);
  f.router.dispatch({ type: 'vrcCurrentInstance', payload: { empty: true } });
  assert.equal(await f.api.currentInstance(), undefined);
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
  f.router.dispatch({ type: 'vrcMyGroups', payload: [{ id: 'grp_1', name: 'Club', iconUrl: 'x' }] });
  f.replies.set('vrcGroupsForNetwork', [{ userId: USER, groups: [{ id: 'grp_1', members: 5 }, { id: 'grp_2', members: 1 }] }]);
  const groups = await f.api.userGroups(USER);
  assert.deepEqual(groups.map((g) => [g.id, g.name, g.memberCount]), [['grp_1', 'Club', 5], ['grp_2', '', 1]]);
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

test('a reply is reported as its raw field names and the addresses in it, nothing else', async () => {
  const notes: string[] = [];
  const f = fake((note) => { notes.push(note); });
  f.replies.set('vrcAvatarDetail', [{
    id: 'avtr_1',
    name: 'Ava',
    // What VRCNext actually sends: its own cache, not the addresses VRChat serves.
    imageUrl: 'http://localhost:51956/imgcache/Avatars/avtr_1.png?v=1',
    thumbnailImageUrl: 'http://localhost:51956/imgcache/Avatars/avtr_1.png?v=1',
    description: 'something the user wrote',
  }]);
  await f.api.avatar('avtr_1');

  const all = notes.join('\n');
  assert.match(all, /vrcGetAvatarDetail: fields .*thumbnailImageUrl/);
  assert.match(all, /addresses .*imgcache/);
  assert.ok(!all.includes('something the user wrote'), 'a value that is not an address stays out of the log');
});
