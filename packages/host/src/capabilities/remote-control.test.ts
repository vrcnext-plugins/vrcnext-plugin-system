import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { Logger } from '@vrcnext/plugin-api';

import type { BridgeClient, PushListener } from './native.js';
import {
  MAX_RESULT_CHARS,
  REMOTE_EVENT,
  attachRemoteControl,
  runSnippet,
  serialise,
  toRemoteRequest,
} from './remote-control.js';

const silent: Logger = {
  debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, scoped: () => silent,
};

/** A bridge client that records the calls made and lets a test push to its listeners. */
function fakeNative(): { native: BridgeClient; calls: unknown[]; push: PushListener } {
  const calls: unknown[] = [];
  let listener: PushListener = () => undefined;
  const native = {
    onPush: (l: PushListener): (() => void) => { listener = l; return () => undefined; },
    call: (_service: string, _method: string, params: unknown): Promise<unknown> => {
      calls.push(params);
      return Promise.resolve({ delivered: true });
    },
  } as unknown as BridgeClient;
  return { native, calls, push: (event, data) => { listener(event, data); } };
}

async function settled(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
}

test('toRemoteRequest accepts only a 22-character base64url id and string code', () => {
  assert.deepEqual(toRemoteRequest({ id: 'AAAAAAAAAAAAAAAAAAAAAA', code: '1' }), { id: 'AAAAAAAAAAAAAAAAAAAAAA', code: '1' });
  assert.equal(toRemoteRequest({ id: 3, code: '1' }), undefined);
  assert.equal(toRemoteRequest({ id: 'short', code: '1' }), undefined);
  assert.equal(toRemoteRequest({ id: 'AAAAAAAAAAAAAAAAAAAAA=', code: '1' }), undefined);
  assert.equal(toRemoteRequest({ id: 'AAAAAAAAAAAAAAAAAAAAAA' }), undefined);
  assert.equal(toRemoteRequest('nope'), undefined);
});

test('runSnippet returns the value of an async function body with the scope in reach', async () => {
  assert.deepEqual(await runSnippet('return a + b', { a: 2, b: 3 }), { ok: true, value: 5 });
  assert.deepEqual(await runSnippet('return await Promise.resolve([x])', { x: 'y' }), { ok: true, value: ['y'] });
  assert.deepEqual(await runSnippet('', {}), { ok: true, value: null });
});

test('runSnippet reports thrown errors and syntax errors instead of raising', async () => {
  assert.deepEqual(await runSnippet('throw new RangeError("nope")', {}), { ok: false, error: 'RangeError: nope' });
  const broken = await runSnippet('return (', {});
  assert.equal(broken.ok, false);
  assert.match(JSON.stringify(broken), /"error":"SyntaxError/);
});

test('serialise keeps JSON, stringifies the rest, and truncates the huge', () => {
  assert.deepEqual(serialise({ a: [1, 'b'] }), { a: [1, 'b'] });
  assert.equal(serialise(undefined), null);
  assert.equal(serialise(() => 1), '() => 1');
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  assert.equal(serialise(cyclic), '[object Object]');
  const big = serialise('x'.repeat(MAX_RESULT_CHARS + 10)) as { truncated: boolean; chars: number; head: string };
  assert.equal(big.truncated, true);
  assert.equal(big.head.length, MAX_RESULT_CHARS);
});

test('attachRemoteControl answers a push with remote/result carrying the same id', async () => {
  const { native, calls, push } = fakeNative();
  attachRemoteControl({ native, logger: silent, scope: { host: { apiVersion: '0.2.0' } } });
  push(REMOTE_EVENT, { id: 'AAAAAAAAAAAAAAAAAAAAAA', code: 'return host.apiVersion' });
  await settled();
  assert.deepEqual(calls, [{ id: 'AAAAAAAAAAAAAAAAAAAAAA', ok: true, value: '0.2.0' }]);
});

test('attachRemoteControl reports a failing snippet and ignores other pushes', async () => {
  const { native, calls, push } = fakeNative();
  attachRemoteControl({ native, logger: silent, scope: {} });
  push('build', { ok: true });
  push(REMOTE_EVENT, { id: 'AAAAAAAAAAAAAAAAAAAAAB', code: 'throw new Error("x")' });
  await settled();
  assert.deepEqual(calls, [{ id: 'AAAAAAAAAAAAAAAAAAAAAB', ok: false, error: 'Error: x' }]);
});
