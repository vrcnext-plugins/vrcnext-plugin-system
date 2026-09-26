import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor, type SettingsStore } from '@vrcnext/plugin-api';

import { JoinMemory } from './memory.js';
import { settings, type Settings } from './settings.js';

/** Only `get`/`set` of the memory key matter here. */
function fakeStore(initialMemory: string): { store: SettingsStore<Settings>; written: string[] } {
  const written: string[] = [];
  const values = { ...defaultsFor(settings), memory: initialMemory };
  const store = {
    values,
    get: (key: keyof Settings) => values[key],
    set: (key: keyof Settings, value: unknown) => {
      (values as Record<string, unknown>)[key] = value;
      if (key === 'memory') written.push(String(value));
      return Promise.resolve();
    },
    reset: () => Promise.resolve(),
    onChange: () => () => undefined,
  } as unknown as SettingsStore<Settings>;
  return { store, written };
}

test('a first join records and reports no previous entry', async () => {
  const { store, written } = fakeStore('{}');
  const memory = new JoinMemory(store);
  assert.equal(await memory.record('usr_1', 'Tupper', 'wrld_a:1'), undefined);
  assert.equal(memory.size, 1);
  assert.equal(written.length, 1);
  assert.equal(memory.previous('usr_1')?.joins, 1);
});

test('a rejoin returns the entry as it was and bumps the count', async () => {
  const { store } = fakeStore(JSON.stringify({ usr_1: { name: 'Tupper', joins: 3, firstSeen: 5, lastSeen: 9, lastLocation: 'x' } }));
  const memory = new JoinMemory(store);
  const before = await memory.record('usr_1', 'Tupper', 'wrld_b:2');
  assert.equal(before?.joins, 3);
  assert.equal(memory.previous('usr_1')?.joins, 4);
  assert.equal(memory.previous('usr_1')?.firstSeen, 5);
});

test('corrupt or foreign memory is treated as empty rather than throwing', () => {
  assert.equal(new JoinMemory(fakeStore('not json').store).size, 0);
  assert.equal(new JoinMemory(fakeStore('[1,2]').store).size, 0);
  assert.equal(new JoinMemory(fakeStore('{"usr_1": 5}').store).size, 0);
});

test('clear empties and persists', async () => {
  const { store, written } = fakeStore(JSON.stringify({ usr_1: { name: 'T', joins: 1, firstSeen: 0, lastSeen: 0, lastLocation: '' } }));
  const memory = new JoinMemory(store);
  await memory.clear();
  assert.equal(memory.size, 0);
  assert.deepEqual(written, ['{}']);
});
