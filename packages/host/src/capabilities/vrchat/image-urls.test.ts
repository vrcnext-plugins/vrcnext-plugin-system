import assert from 'node:assert/strict';
import { test } from 'vitest';

import { resolveImageUrl, type BridgeCall } from './image-urls.js';

interface Asked {
  readonly service: string;
  readonly method: string;
  readonly params: unknown;
}

function bridge(answer: unknown): { asked: Asked[]; call: BridgeCall } {
  const asked: Asked[] = [];
  const call: BridgeCall = (service, method, params) => {
    asked.push({ service, method, params });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { asked, call };
}

test('a key is asked of the bridge as a bound parameter, never spliced into the statement', async () => {
  const { asked, call } = bridge({ rows: [{ url: 'https://api.vrchat.cloud/api/1/image/file_a/1/800' }] });
  const url = await resolveImageUrl(call, 'Users/usr_1');
  assert.equal(url, 'https://api.vrchat.cloud/api/1/image/file_a/1/800');

  const one = asked[0];
  assert.ok(one !== undefined);
  assert.deepEqual([one.service, one.method], ['sql', 'query']);
  const params = one.params as { sql: string; params: readonly unknown[]; database: string };
  assert.equal(params.database, 'vrcnext');
  assert.deepEqual(params.params, ['Users/usr_1']);
  assert.ok(!params.sql.includes('usr_1'), 'the key belongs in params, not in the statement');
});

test('no bridge is an empty answer, and nothing is asked', async () => {
  assert.equal(await resolveImageUrl(undefined, 'Users/usr_1'), '');
});

test('a picture VRCNext never cached has no row, which is an empty answer', async () => {
  const { call } = bridge({ rows: [] });
  assert.equal(await resolveImageUrl(call, 'Users/usr_nobody'), '');
});

test('an answer that is not the expected shape is empty rather than a crash', async () => {
  for (const answer of [undefined, null, {}, { rows: undefined }, { rows: [{}] }, { rows: [{ url: 42 }] }, 'nope']) {
    const { call } = bridge(answer);
    assert.equal(await resolveImageUrl(call, 'Users/usr_1'), '', `${JSON.stringify(answer)} should be ''`);
  }
});

test('a bridge that refuses rejects, for the caller to treat as no picture', async () => {
  const { call } = bridge(new Error('not paired'));
  await assert.rejects(() => resolveImageUrl(call, 'Users/usr_1'), /not paired/);
});
