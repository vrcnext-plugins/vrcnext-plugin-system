import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import type { SettingsSchema } from '@vrcnext/plugin-api';

import { MemoryStateService } from '../state/state-service.js';
import { PluginSettingsStore } from './plugin-settings-store.js';

afterEach(() => { vi.useRealTimers(); });

const schema = {
  enabled: { kind: 'boolean', label: 'On', default: true },
  volume: { kind: 'number', label: 'Volume', default: 5, min: 0, max: 10 },
  mode: { kind: 'select', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
} as const satisfies SettingsSchema;

test('loads from the plugin namespace, filling defaults and dropping values that no longer fit', async () => {
  const state = new MemoryStateService();
  await state.set('plugin:x', 'enabled', false);
  await state.set('plugin:x', 'volume', 99);
  await state.set('plugin:x', 'mode', 'zzz');
  const store = await PluginSettingsStore.load(schema, 'plugin:x', state, () => undefined);
  assert.deepEqual(store.values, { enabled: false, volume: 10, mode: 'a' });
});

test('set updates synchronously, notifies, and persists debounced under the key', async () => {
  vi.useFakeTimers();
  const state = new MemoryStateService();
  const store = await PluginSettingsStore.load(schema, 'plugin:x', state, () => undefined);
  const seen: string[] = [];
  store.onChange((values) => { seen.push(values.mode); });
  const pending = store.set('mode', 'b');
  assert.equal(store.get('mode'), 'b');
  assert.deepEqual(seen, ['b']);
  assert.deepEqual(state.writes, []);
  await vi.advanceTimersByTimeAsync(250);
  await pending;
  assert.deepEqual(state.writes, [{ ns: 'plugin:x', key: 'mode', value: 'b' }]);
});

test('rejects unknown keys and values of the wrong kind', async () => {
  const store = await PluginSettingsStore.load(schema, 'plugin:x', new MemoryStateService(), () => undefined);
  await assert.rejects(store.set('nope' as never, 1 as never), /not declared/);
  await assert.rejects(store.set('volume', 'loud' as never), /declared kind/);
});

test('reset restores every default and flush pushes it out', async () => {
  vi.useFakeTimers();
  const state = new MemoryStateService();
  const store = await PluginSettingsStore.load(schema, 'plugin:x', state, () => undefined);
  void store.set('volume', 1);
  void store.reset();
  await store.flush();
  assert.deepEqual(store.values, { enabled: true, volume: 5, mode: 'a' });
  assert.equal(state.writes.find((w) => w.key === 'volume')?.value, 5);
});
