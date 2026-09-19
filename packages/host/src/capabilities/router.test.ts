import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';

import { ROUTE_PREFIX, PluginRouter, RouteTable } from './router.js';
import type { PluginId } from '@vrcnext/plugin-api';

const PLUGIN = 'demo' as PluginId;

let table: RouteTable;
let disposers: (() => void)[];

const ORIGIN = 'http://localhost:51888/app/index.html';

beforeEach(() => {
  // The table takes its base explicitly, so no DOM globals are needed here.
  table = new RouteTable(ORIGIN);
  table.install();
  disposers = [];
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  table.uninstall();
});

function router(): PluginRouter {
  return new PluginRouter(table, PLUGIN, ORIGIN, (dispose) => disposers.push(dispose));
}

test('mounts routes under the plugin base path', () => {
  assert.equal(router().base.pathname, `${ROUTE_PREFIX}${PLUGIN}/`);
});

test('dispatches a GET route', async () => {
  const api = router();
  api.get('stats', () => Response.json({ ok: true }));

  const response = await api.fetch('stats');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('captures :name path parameters', async () => {
  const api = router();
  api.get('greet/:name', (request) => Response.json({ name: request.params['name'] }));

  const response = await api.fetch('greet/blu');
  assert.deepEqual(await response.json(), { name: 'blu' });
});

test('decodes encoded path parameters', async () => {
  const api = router();
  api.get('echo/:value', (request) => Response.json({ value: request.params['value'] }));

  const response = await api.fetch(`echo/${encodeURIComponent('a/b c')}`);
  assert.deepEqual(await response.json(), { value: 'a/b c' });
});

test('separates methods on the same pattern', async () => {
  const api = router();
  api.get('thing', () => Response.json({ method: 'GET' }));
  api.post('thing', () => Response.json({ method: 'POST' }));

  assert.deepEqual(await (await api.fetch('thing')).json(), { method: 'GET' });
  assert.deepEqual(await (await api.fetch('thing', { method: 'POST' })).json(), { method: 'POST' });
});

test('reads a JSON request body', async () => {
  const api = router();
  api.post('echo', async (request) => Response.json(await request.json()));

  const response = await api.fetch('echo', {
    method: 'POST',
    body: JSON.stringify({ hello: 'world' }),
  });
  assert.deepEqual(await response.json(), { hello: 'world' });
});

test('answers 404 when nothing matches', async () => {
  const response = await router().fetch('missing');
  assert.equal(response.status, 404);
});

test('answers 500 when a handler throws, without breaking the table', async () => {
  const api = router();
  api.get('boom', () => { throw new Error('handler failure'); });
  api.get('fine', () => Response.json({ ok: true }));

  assert.equal((await api.fetch('boom')).status, 500);
  assert.equal((await api.fetch('fine')).status, 200);
});

test('rejects a duplicate method and pattern', () => {
  const api = router();
  api.get('dup', () => new Response(''));
  assert.throws(() => { api.get('dup', () => new Response('')); }, /already registered/);
});

test('unregistering a route stops it matching', async () => {
  const api = router();
  const dispose = api.get('temp', () => Response.json({ ok: true }));
  assert.equal((await api.fetch('temp')).status, 200);
  dispose();
  assert.equal((await api.fetch('temp')).status, 404);
});

test('leaves non-plugin requests to the original fetch', async () => {
  const original = globalThis.fetch;
  table.uninstall();

  let delegated = false;
  globalThis.fetch = (): Promise<Response> => {
    delegated = true;
    return Promise.resolve(new Response('upstream'));
  };
  const replaced = globalThis.fetch;
  table = new RouteTable(ORIGIN);
  table.install();

  const response = await globalThis.fetch('https://example.com/thing');
  assert.equal(delegated, true);
  assert.equal(await response.text(), 'upstream');

  table.uninstall();
  assert.equal(globalThis.fetch, replaced);
  globalThis.fetch = original;
});
