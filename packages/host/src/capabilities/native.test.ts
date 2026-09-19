/**
 * The companion's absence is the common case, so "degrades cleanly" is the property worth testing.
 * A rejected promise here would surface as an unhandled rejection inside whatever event handler a
 * plugin called `notify()` from.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import type { Logger } from '@vrcnext/plugin-api';

import { NativeClient } from './native.js';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  scoped: () => silentLogger,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response): void {
  globalThis.fetch = ((url: string, init: RequestInit = {}) =>
    Promise.resolve(handler(url, init))) as typeof globalThis.fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test('reports unavailable when nothing is listening', async () => {
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const client = new NativeClient(silentLogger);

  assert.equal(await client.probe(), false);
  assert.equal(client.available, false);
});

test('notify resolves instead of rejecting when the companion is gone', async () => {
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const client = new NativeClient(silentLogger);

  const result = await client.notify({ title: 'x' });
  assert.deepEqual(result, { ok: false, delivered: [], failed: [] });
});

test('targets resolves to an empty list rather than throwing', async () => {
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  assert.deepEqual(await new NativeClient(silentLogger).targets(), []);
});

test('becomes available once health answers', async () => {
  stubFetch(() => json({ ok: true, version: '0.1.0', services: ['notify'] }));
  const client = new NativeClient(silentLogger);

  assert.equal(await client.probe(), true);
  assert.equal(client.available, true);
});

test('sends JSON content type, which is what forces the CORS preflight', async () => {
  let seen: RequestInit | undefined;
  stubFetch((_url, init) => {
    seen = init;
    return json({ ok: true, delivered: ['wayvr'], failed: [] });
  });

  await new NativeClient(silentLogger).notify({ title: 'x', sinks: ['wayvr'] });

  const headers = seen?.headers as Record<string, string> | undefined;
  assert.equal(headers?.['Content-Type'], 'application/json');
  assert.equal(seen?.method, 'POST');
});

test('passes sinks and overrides through untouched', async () => {
  let body: unknown;
  stubFetch((_url, init) => {
    body = JSON.parse(typeof init.body === 'string' ? init.body : '');
    return json({ ok: true, delivered: ['wayvr'], failed: [] });
  });

  await new NativeClient(silentLogger).notify({
    title: 'Friend online',
    sinks: ['wayvr'],
    overrides: { wayvr: { height: 220, opacity: 0.85 } },
  });

  assert.deepEqual(body, {
    title: 'Friend online',
    sinks: ['wayvr'],
    overrides: { wayvr: { height: 220, opacity: 0.85 } },
  });
});

test('surfaces the companion’s own error code and message', async () => {
  stubFetch(() =>
    json({ ok: false, error: { code: 'bad_request', message: '`title` must not be empty' } }, 400),
  );

  await assert.rejects(
    () => new NativeClient(silentLogger).call('notify', 'send', { title: '' }),
    /bad_request: `title` must not be empty/,
  );
});

test('trims a trailing slash so the endpoint is not doubled', () => {
  assert.equal(
    new NativeClient(silentLogger, 'http://127.0.0.1:42081/').endpoint,
    'http://127.0.0.1:42081',
  );
});
