import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import { DebouncedWriter } from './debounced-writer.js';
import { BridgeStateService, MemoryStateService } from './state-service.js';

afterEach(() => { vi.useRealTimers(); });

test('the bridge state service speaks the state/get,set,delete,list shapes', async () => {
  const calls: { method: string; params: unknown }[] = [];
  const service = new BridgeStateService((_service, method, params) => {
    calls.push({ method, params });
    if (method === 'get') return Promise.resolve({ value: 42 });
    if (method === 'list') return Promise.resolve({ entries: { a: 1 } });
    return Promise.resolve({});
  });
  assert.equal(await service.get('host', 'k'), 42);
  await service.set('host', 'k', true);
  await service.delete('host', 'k');
  assert.deepEqual(await service.list('plugin:x'), { a: 1 });
  assert.deepEqual(calls, [
    { method: 'get', params: { ns: 'host', key: 'k' } },
    { method: 'set', params: { ns: 'host', key: 'k', value: true } },
    { method: 'delete', params: { ns: 'host', key: 'k' } },
    { method: 'list', params: { ns: 'plugin:x' } },
  ]);
});

test('a null value from the bridge reads as undefined', async () => {
  const service = new BridgeStateService(() => Promise.resolve({ value: null }));
  assert.equal(await service.get('host', 'missing'), undefined);
});

test('writes within the window are coalesced to the last value per key', async () => {
  vi.useFakeTimers();
  const store = new MemoryStateService();
  const writer = new DebouncedWriter(store, 'plugin:x', () => undefined);
  const done = Promise.all([writer.set('a', 1), writer.set('a', 2), writer.set('b', 'x')]);
  assert.deepEqual(store.writes, []);
  await vi.advanceTimersByTimeAsync(250);
  await done;
  assert.deepEqual(store.writes, [
    { ns: 'plugin:x', key: 'a', value: 2 },
    { ns: 'plugin:x', key: 'b', value: 'x' },
  ]);
});

test('flush sends what is queued without waiting', async () => {
  vi.useFakeTimers();
  const store = new MemoryStateService();
  const writer = new DebouncedWriter(store, 'plugin:x', () => undefined);
  void writer.set('a', 1);
  await writer.flush();
  assert.equal(store.writes.length, 1);
});

test('a failed write is reported, and later writes still go out', async () => {
  vi.useFakeTimers();
  const errors: unknown[] = [];
  let fail = true;
  const store = new MemoryStateService();
  const service = {
    set: (ns: string, key: string, value: unknown): Promise<void> => {
      if (fail) return Promise.reject(new Error('disk full'));
      return store.set(ns, key, value);
    },
    get: store.get.bind(store),
    delete: store.delete.bind(store),
    list: store.list.bind(store),
  };
  const writer = new DebouncedWriter(service, 'plugin:x', (error) => { errors.push(error); });
  void writer.set('a', 1);
  await writer.flush();
  assert.equal(errors.length, 1);
  fail = false;
  void writer.set('a', 2);
  await writer.flush();
  assert.deepEqual(store.writes, [{ ns: 'plugin:x', key: 'a', value: 2 }]);
});
