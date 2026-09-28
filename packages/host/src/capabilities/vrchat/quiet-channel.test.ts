/**
 * The quiet channel against a fake Photino callback list: VRCNext's handler is index 0, the
 * host's router is registered after install, and replies are pushed through both like Photino
 * would.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { EventRouter } from '../../events/event-router.js';
import { FOLLOW_UP_MS, QuietChannel } from './quiet-channel.js';

interface Fixture {
  readonly channel: QuietChannel;
  readonly sent: { action: string; args: unknown }[];
  readonly seenByVrcnext: string[];
  readonly router: EventRouter;
  deliver(type: string, payload: unknown): void;
}

function fixture(options: { readonly callbacks?: boolean; now?: () => number } = {}): Fixture {
  const callbacks: ((raw: string) => void)[] = [];
  const seenByVrcnext: string[] = [];
  const sent: { action: string; args: unknown }[] = [];
  const router = new EventRouter();
  if (options.callbacks !== false) callbacks.push((raw) => { seenByVrcnext.push(raw); });
  const channel = new QuietChannel({
    send: (action, args) => { sent.push({ action, args }); },
    router,
    callbacks: () => (options.callbacks === false ? undefined : callbacks),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  channel.install();
  callbacks.push((raw) => { router.dispatchRaw(raw); });
  return {
    channel,
    sent,
    seenByVrcnext,
    router,
    deliver: (type, payload) => {
      const raw = JSON.stringify({ type, payload });
      for (const callback of [...callbacks]) callback(raw);
    },
  };
}

test('a matching reply resolves the request and is withheld from VRCNext', async () => {
  const f = fixture();
  const hostSaw: unknown[] = [];
  f.router.on('vrcFriendDetail', (p) => { hostSaw.push(p); });
  const pending = f.channel.request({
    action: 'vrcGetFriendDetail',
    args: { userId: 'usr_1' },
    expect: 'vrcFriendDetail',
    accept: (p) => ((p as { id?: string }).id === 'usr_1' ? p : undefined),
  });
  assert.deepEqual(f.sent, [{ action: 'vrcGetFriendDetail', args: { userId: 'usr_1' } }]);

  f.deliver('vrcFriendDetail', { id: 'usr_other' });
  f.deliver('vrcFriendDetail', { id: 'usr_1', displayName: 'Tupper' });
  assert.deepEqual(await pending, { id: 'usr_1', displayName: 'Tupper' });
  assert.equal(f.seenByVrcnext.length, 1, 'only the unrelated reply reached VRCNext');
  assert.match(f.seenByVrcnext[0] ?? '', /usr_other/);
  assert.equal(hostSaw.length, 2, 'the host router still sees everything');
});

test('a swallow: false request lets VRCNext handle its reply too', async () => {
  const f = fixture();
  const pending = f.channel.request({ action: 'vrcGetMyGroups', expect: 'vrcMyGroups', accept: (p) => p, swallow: false });
  f.deliver('vrcMyGroups', [{ id: 'grp_1' }]);
  assert.deepEqual(await pending, [{ id: 'grp_1' }]);
  assert.equal(f.seenByVrcnext.length, 1);
});

function worldRequest(f: Fixture): Promise<unknown> {
  return f.channel.request({
    action: 'vrcGetWorldDetail',
    expect: 'vrcWorldDetail',
    accept: (p) => ((p as { id?: string }).id === 'wrld_1' ? p : undefined),
  });
}

test('exactly one follow-up reply after the answer is withheld, then the rule is gone', async () => {
  const f = fixture();
  const pending = worldRequest(f);
  f.deliver('vrcWorldDetail', { id: 'wrld_1', fromCache: true });
  await pending;
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  assert.equal(f.seenByVrcnext.length, 0, 'the fresh copy is withheld as well');
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  assert.equal(f.seenByVrcnext.length, 1, 'a third reply is VRCNext’s own');
  assert.equal(f.channel.pending, 0);
});

test('a follow-up later than the window is not withheld', async () => {
  let now = 1_000;
  const f = fixture({ now: () => now });
  const pending = worldRequest(f);
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  await pending;
  now += FOLLOW_UP_MS + 1;
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  assert.equal(f.seenByVrcnext.length, 1);
});

test('once VRCNext itself sends the action, its reply reaches VRCNext', async () => {
  const f = fixture();
  const pending = worldRequest(f);
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  await pending;
  f.channel.noteOutbound('vrcGetWorldDetail');
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  assert.equal(f.seenByVrcnext.length, 1, 'the user opened that world: the reply is theirs');

  const second = worldRequest(f);
  f.channel.noteOutbound('vrcGetWorldDetail');
  f.deliver('vrcWorldDetail', { id: 'wrld_1' });
  await second;
  assert.equal(f.seenByVrcnext.length, 2, 'a pending rule still resolves, but shares the reply');
});

test('times out, and an aborted request stops listening', async () => {
  const f = fixture();
  await assert.rejects(
    f.channel.request({ action: 'x', expect: 'y', accept: (p) => p, timeoutMs: 5 }),
    /did not answer "x"/,
  );
  const controller = new AbortController();
  const pending = f.channel.request({ action: 'x', expect: 'y', accept: (p) => p, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
  f.deliver('y', 1);
  assert.equal(f.seenByVrcnext.length, 1, 'nothing withheld after the abort');
});

test('without a callback list it falls back to the router and cannot withhold', async () => {
  const f = fixture({ callbacks: false });
  const pending = f.channel.request({ action: 'a', expect: 'b', accept: (p) => p });
  f.router.dispatch({ type: 'b', payload: 42 });
  assert.equal(await pending, 42);
});

test('uninstall restores VRCNext’s original callback', () => {
  const callbacks: ((raw: string) => void)[] = [];
  const original = (): void => undefined;
  callbacks.push(original);
  const channel = new QuietChannel({ send: () => undefined, router: new EventRouter(), callbacks: () => callbacks });
  channel.install();
  assert.notEqual(callbacks[0], original);
  channel.uninstall();
  assert.equal(callbacks[0], original);
});
