/**
 * `ctx.sql` against a fake bridge client: the three result shapes, and what a malformed reply
 * does. The service's own guarantees (read-only, one statement, caps) are the bridge's tests.
 *
 * The replies here are the shape the bridge actually sends, checked against a live daemon:
 * `rows` is an array of objects keyed by column name, never positional arrays.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { BridgeClient } from './native.js';
import { HostSqlApi } from './sql-api.js';

interface Call {
  readonly service: string;
  readonly method: string;
  readonly params: unknown;
}

function fixture(reply: unknown): { api: HostSqlApi; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    call: (service: string, method: string, params: unknown) => {
      calls.push({ service, method, params });
      return Promise.resolve(reply);
    },
  } as unknown as BridgeClient;
  return { api: new HostSqlApi(client), calls };
}

const RESULT = { columns: ['id', 'n'], rows: [{ id: 'usr_1', n: 14 }, { id: 'usr_2', n: 3 }] };

test('a query reaches the sql service with its parameters bound, not interpolated', async () => {
  const f = fixture(RESULT);
  const result = await f.api.query('vrcnext', 'SELECT id, n FROM t WHERE id = ?1', ['usr_1']);
  assert.deepEqual(f.calls, [{
    service: 'sql',
    method: 'query',
    params: { database: 'vrcnext', sql: 'SELECT id, n FROM t WHERE id = ?1', params: ['usr_1'] },
  }]);
  assert.deepEqual(result, RESULT);
});

test('rows() keys each row by column name', async () => {
  const f = fixture(RESULT);
  assert.deepEqual(await f.api.rows('vrcnext', 'SELECT id, n FROM t'), [
    { id: 'usr_1', n: 14 },
    { id: 'usr_2', n: 3 },
  ]);
});

test('value() answers the first column of the first row — the count shape', async () => {
  const f = fixture({ columns: ['n'], rows: [{ n: 5500 }] });
  assert.equal(await f.api.value('vrcnext', 'SELECT count(*) AS n FROM events'), 5500);
});

test('value() is undefined when nothing matched, which is not the same as 0', async () => {
  const f = fixture({ columns: ['n'], rows: [] });
  assert.equal(await f.api.value('vrcnext', 'SELECT n FROM t WHERE 0'), undefined);
});

test('a reply that is not a result reads as empty rather than throwing', async () => {
  for (const reply of [null, 'nope', 42, {}, { columns: 'x', rows: 'y' }]) {
    const f = fixture(reply);
    assert.deepEqual(await f.api.query('vrcnext', 'SELECT 1'), { columns: [], rows: [] });
    assert.deepEqual(await f.api.rows('vrcnext', 'SELECT 1'), []);
  }
});

test('a row that is not an object is dropped, not indexed into', async () => {
  // A positional array was what this client first assumed, and it read every column as
  // undefined without failing. Anything but an object is now discarded outright.
  const f = fixture({ columns: ['a'], rows: [['only'], 42, null, { a: 'kept' }] });
  assert.deepEqual(await f.api.rows('vrcnext', 'SELECT a FROM t'), [{ a: 'kept' }]);
});

test('value() names the first column by position, since a row object has no order', async () => {
  const f = fixture({ columns: ['n', 'other'], rows: [{ other: 'x', n: 7 }] });
  assert.equal(await f.api.value('vrcnext', 'SELECT n, other FROM t'), 7);
});

test('databases() lists what the bridge will open', async () => {
  const f = fixture({ databases: [{ alias: 'vrcnext', writable: false, about: 'records' }] });
  assert.deepEqual(await f.api.databases(), [{ alias: 'vrcnext', writable: false, about: 'records' }]);
  assert.equal(f.calls[0]?.method, 'databases');
});
