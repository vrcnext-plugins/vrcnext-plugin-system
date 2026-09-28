/**
 * OSC goes through VRCNext where VRCNext carries it, and through the bridge where it does not.
 *
 * The point of the second path is that a plugin cannot tell which one it got: the same calls,
 * the same events, the same sockets underneath.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { Bridge, DisposableBag, Logger } from '@vrcnext/plugin-api';

import type { EventRouter } from '../events/event-router.js';
import type { BridgeClient } from './native.js';
import { HostOscApi } from './osc-api.js';

interface Harness {
  readonly osc: HostOscApi;
  readonly sent: { action: string; payload: unknown }[];
  readonly calls: { method: string; params: unknown }[];
  readonly warnings: string[];
  readonly pushTo: (event: string, data: unknown) => void;
}

function harness(options: { readonly linux: boolean; readonly bridgeHasOsc: boolean }): Harness {
  const sent: { action: string; payload: unknown }[] = [];
  const calls: { method: string; params: unknown }[] = [];
  const warnings: string[] = [];
  const pushListeners: ((event: string, data: unknown) => void)[] = [];

  const bridge = { send: (action: string, payload?: unknown) => { sent.push({ action, payload }); } } as unknown as Bridge;
  const native = {
    describe: () => (options.bridgeHasOsc ? { version: '0.4.0', services: { osc: {} } } : { version: '0.3.1', services: {} }),
    call: (_service: string, method: string, params: unknown) => { calls.push({ method, params }); return Promise.resolve({}); },
    onPush: (listener: (event: string, data: unknown) => void) => { pushListeners.push(listener); return () => undefined; },
  } as unknown as BridgeClient;

  const osc = new HostOscApi({
    bridge,
    router: { on: () => () => undefined } as unknown as EventRouter,
    bag: { add: () => undefined } as unknown as DisposableBag,
    logger: { warn: (message: string) => { warnings.push(message); } } as unknown as Logger,
    available: !options.linux,
    native,
  });
  return {
    osc,
    sent,
    calls,
    warnings,
    pushTo: (event, data) => { for (const listener of pushListeners) listener(event, data); },
  };
}

test('on Windows the call is VRCNext’s own action and the bridge is not involved', () => {
  const h = harness({ linux: false, bridgeHasOsc: true });
  assert.equal(h.osc.available, true);
  h.osc.send('Seated', 'bool', true);
  assert.deepEqual(h.sent, [{ action: 'oscSend', payload: { name: 'Seated', type: 'bool', value: true } }]);
  assert.deepEqual(h.calls, [], 'VRCNext carries it, so the bridge is left alone');
});

test('on Linux the same call goes to the bridge, with the parameter prefix and the kind kept', () => {
  const h = harness({ linux: true, bridgeHasOsc: true });
  assert.equal(h.osc.available, true, 'the bridge makes OSC available where VRCNext does not');
  h.osc.send('Seated', 'bool', true);
  assert.deepEqual(h.calls, [
    { method: 'send', params: { address: '/avatar/parameters/Seated', args: [{ kind: 'bool', value: true }] } },
  ]);
  assert.deepEqual(h.sent, [], 'VRCNext would have dropped it');
});

test('a whole number keeps the float kind it was sent with', () => {
  const h = harness({ linux: true, bridgeHasOsc: true });
  h.osc.sendRaw('/avatar/parameters/Scale', 'float', 1);
  assert.deepEqual(h.calls[0]?.params, {
    address: '/avatar/parameters/Scale',
    args: [{ kind: 'float', value: 1 }],
  });
});

test('a bridge with no osc service leaves OSC unavailable, and says so rather than dropping it silently', () => {
  const h = harness({ linux: true, bridgeHasOsc: false });
  assert.equal(h.osc.available, false);
  h.osc.send('Seated', 'bool', true);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.sent, []);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0] ?? '', /no osc service/);
});

test('a parameter pushed by the bridge arrives as a parameter event, prefix stripped', () => {
  const h = harness({ linux: true, bridgeHasOsc: true });
  const seen: unknown[] = [];
  h.osc.onParam((event) => { seen.push(event); });
  assert.deepEqual(h.calls, [{ method: 'listen', params: {} }], 'listening opens the receive port');

  h.pushTo('osc', { address: '/avatar/parameters/VRCEmote', args: [{ kind: 'int', value: 3 }] });
  assert.deepEqual(seen, [{ name: 'VRCEmote', value: 3, kind: 'int' }]);

  h.pushTo('osc', { address: '/tracking/head', args: [{ kind: 'float', value: 1 }] });
  assert.equal(seen.length, 1, 'only avatar parameters are parameter events');
});

test('an avatar change pushed by the bridge carries the id and claims no parameter list', () => {
  const h = harness({ linux: true, bridgeHasOsc: true });
  const seen: { avatarId: string; parameters: readonly unknown[] }[] = [];
  h.osc.onAvatarChange((event) => { seen.push(event); });
  h.pushTo('osc', { address: '/avatar/change', args: [{ kind: 'string', value: 'avtr_1' }] });
  assert.deepEqual(seen, [{ avatarId: 'avtr_1', parameters: [] }]);
});
