import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { activityLine, isActivityWorthy, mirrorToActivityLog } from './activity-log.js';
import { LogSink } from './log-sink.js';

let rows: [string, string | undefined][];
let dom: JSDOM;

beforeEach(() => {
  rows = [];
  dom = new JSDOM('<!doctype html><body><div id="logArea"></div></body>');
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['addLog'] = (message: string, color?: string): void => {
    rows.push([message, color]);
  };
});

afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  delete scope['addLog'];
  delete scope['document'];
  vi.useRealTimers();
});

test('activityLine keeps the scope as a lower-case prefix and appends detail', () => {
  assert.equal(
    activityLine({ at: 0, level: 'info', scope: 'club-security', message: 'Watching.', detail: [] }),
    '[club-security] Watching.',
  );
  assert.equal(
    activityLine({ at: 0, level: 'error', scope: 'host', message: 'Failed', detail: ['Error: x', '{"a":1}'] }),
    '[host] Failed Error: x {"a":1}',
  );
});

test('debug records are not activity', () => {
  assert.equal(isActivityWorthy({ at: 0, level: 'debug', scope: 'host', message: 'm', detail: [] }), false);
  assert.equal(isActivityWorthy({ at: 0, level: 'info', scope: 'host', message: 'm', detail: [] }), true);
});

test('mirrorToActivityLog replays existing records, follows new ones with VRCNext colours, and stops', () => {
  const sink = new LogSink();
  sink.write('info', 'host', 'Booted', []);
  sink.write('debug', 'host', 'noise', []);

  const stop = mirrorToActivityLog(sink);
  sink.write('warn', 'club-security', 'Slow', []);
  sink.write('error', 'native', 'Gone', [new Error('boom')]);
  stop();
  sink.write('info', 'host', 'after stop', []);

  assert.deepEqual(rows, [
    ['[host] Booted', undefined],
    ['[club-security] Slow', 'warn'],
    ['[native] Gone Error: boom', 'err'],
  ]);
});

test('waits for VRCNext to load the log area, then replays what was logged meanwhile', () => {
  vi.useFakeTimers();
  dom.window.document.getElementById('logArea')?.remove();
  const sink = new LogSink();
  sink.write('info', 'host', 'early', []);
  const stop = mirrorToActivityLog(sink);
  vi.advanceTimersByTime(1_500);
  assert.deepEqual(rows, [], 'nothing until the area exists');

  const area = dom.window.document.createElement('div');
  area.id = 'logArea';
  dom.window.document.body.appendChild(area);
  vi.advanceTimersByTime(500);
  sink.write('info', 'host', 'late', []);
  assert.deepEqual(rows, [['[host] early', undefined], ['[host] late', undefined]]);
  stop();
});

test('stopping while still waiting cancels the wait', () => {
  vi.useFakeTimers();
  dom.window.document.getElementById('logArea')?.remove();
  const sink = new LogSink();
  const stop = mirrorToActivityLog(sink);
  stop();
  const area = dom.window.document.createElement('div');
  area.id = 'logArea';
  dom.window.document.body.appendChild(area);
  vi.advanceTimersByTime(2_000);
  sink.write('info', 'host', 'x', []);
  assert.deepEqual(rows, []);
});

test('a page without addLog is left alone', () => {
  delete (globalThis as Record<string, unknown>)['addLog'];
  const sink = new LogSink();
  const stop = mirrorToActivityLog(sink);
  sink.write('info', 'host', 'x', []);
  stop();
  assert.deepEqual(rows, []);
});
