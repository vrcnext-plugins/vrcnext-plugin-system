import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';

import { DebugHub } from './debug-hub.js';
import { LogSink } from './log-sink.js';

let sink: LogSink;
let hub: DebugHub;

const store = new Map<string, string>();
const storageMock: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};

beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>)['localStorage'] = storageMock;
  sink = new LogSink();
  hub = new DebugHub(sink);
});

afterEach(() => {
  hub.dispose();
  sink.dispose();
  store.clear();
});

test('captures console.error and console.warn when enabled', () => {
  hub.enabled = true;
  assert.equal(hub.enabled, true);

  console.error('test error message', new Error('boom'));
  console.warn('test warning message');

  const records = sink.records;
  const errRecord = records.find((r) => r.scope === 'console' && r.level === 'error');
  const warnRecord = records.find((r) => r.scope === 'console' && r.level === 'warn');

  assert.ok(errRecord, 'console.error record missing');
  assert.ok(errRecord.message.includes('test error message'));
  assert.ok(errRecord.message.includes('boom'));

  assert.ok(warnRecord, 'console.warn record missing');
  assert.ok(warnRecord.message.includes('test warning message'));
});

test('restores original console when disabled', () => {
  hub.enabled = true;
  hub.enabled = false;

  const countBefore = sink.records.length;
  console.error('should not be captured');

  assert.equal(sink.records.length, countBefore);
});

test('logs UI events only when enabled', () => {
  hub.enabled = false;
  hub.logUi('Button clicked', 'Sidebar');
  assert.equal(sink.records.filter((r) => r.scope === 'ui').length, 0);

  hub.enabled = true;
  hub.logUi('Button clicked', 'Sidebar');
  const uiRecord = sink.records.find((r) => r.scope === 'ui');
  assert.ok(uiRecord);
  assert.equal(uiRecord.message, 'Button clicked: Sidebar');
  assert.equal(uiRecord.level, 'debug');
});
