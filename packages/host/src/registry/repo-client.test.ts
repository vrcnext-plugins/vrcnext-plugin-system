/**
 * The forge's cache headers must not decide when a plugin update becomes visible.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { fetchPluginBundle, fetchRepoManifest } from './repo-client.js';
import { parseRepoSource } from './repo-source.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function source() {
  const { source: parsed } = parseRepoSource('o/r');
  assert.ok(parsed !== undefined);
  return parsed;
}

test('manifest and bundle fetches revalidate instead of trusting the forge max-age', async () => {
  const inits: RequestInit[] = [];
  globalThis.fetch = ((_url: URL, init: RequestInit = {}) => {
    inits.push(init);
    return Promise.resolve(new Response(
      JSON.stringify({ formatVersion: 1, name: 'x', plugins: [] }),
      { status: 200 },
    ));
  }) as typeof globalThis.fetch;

  await fetchRepoManifest(source());
  await fetchPluginBundle(source(), 'dist/plugin.js');

  assert.equal(inits.length, 2);
  for (const init of inits) {
    assert.equal(init.cache, 'no-cache');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
  }
});
