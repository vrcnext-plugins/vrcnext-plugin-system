/**
 * The bridge's absence is the common case, so "degrades cleanly" is the property worth testing.
 * A rejected promise here would surface as an unhandled rejection inside whatever event handler a
 * plugin called `notify()` from.
 *
 * The socket is faked at the `WebSocket` global: the tests drive open/close/message by hand and
 * inspect what was sent, which is the whole contract the client has with the daemon.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Logger } from '@vrcnext/plugin-api';

import { LogSink } from '../log/log-sink.js';
import { NativeClient, NativeRequestError, NativeTransportError } from './native.js';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  scoped: () => silentLogger,
};

type Listener = (event: { readonly data?: unknown }) => void;

class FakeSocket {
  static readonly instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeSocket.CONNECTING;
  readonly #listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }

  send(data: string): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('not open');
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.#emit('close', {});
  }

  /** Test driver: the daemon accepted the connection. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.#emit('open', {});
  }

  /** Test driver: the daemon refused, or went away. */
  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.#emit('close', {});
  }

  /** Test driver: a frame from the daemon. */
  receive(frame: unknown): void {
    this.#emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  /** The last frame sent, parsed. */
  last(): Record<string, unknown> {
    return JSON.parse(this.sent.at(-1) ?? '{}') as Record<string, unknown>;
  }

  #emit(type: string, event: { readonly data?: unknown }): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

const realWebSocket = globalThis.WebSocket;
const realFetch = globalThis.fetch;

beforeEach(() => {
  FakeSocket.instances.length = 0;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
});

afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

function healthOk(): void {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, version: '0.1.0', services: ['notify'] })),
    );
}

/** A client whose socket the daemon has accepted. */
function connected(): { client: NativeClient; socket: FakeSocket } {
  const client = new NativeClient(silentLogger);
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  socket.open();
  return { client, socket };
}

/** Let a promise chain advance, under fake timers. */
const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

test('opens the socket at /v1/ws under the endpoint', () => {
  const client = new NativeClient(silentLogger, 'http://127.0.0.1:42081/');
  assert.equal(client.endpoint, 'http://127.0.0.1:42081');
  assert.equal(FakeSocket.instances.at(-1)?.url, 'ws://127.0.0.1:42081/v1/ws');
});

test('is not_detected until something answers', async () => {
  const client = new NativeClient(silentLogger);
  assert.equal(client.status, 'not_detected');
  assert.equal(await client.probe(), false);
  assert.equal(client.available, false);
});

test('is running_not_connected when health answers but the socket is closed', async () => {
  healthOk();
  const client = new NativeClient(silentLogger);
  assert.equal(await client.probe(), true);
  assert.equal(client.status, 'running_not_connected');
  assert.equal(client.available, true, 'detected, even though calls would not go through');
});

test('is connected once the socket opens, without waiting for the probe', () => {
  const { client } = connected();
  assert.equal(client.status, 'connected');
  assert.equal(client.available, true);
});

test('drops back to running_not_connected when the daemon goes away', () => {
  const { client, socket } = connected();
  const seen: string[] = [];
  client.onStatus((status) => { seen.push(status); });
  socket.drop();
  assert.equal(client.status, 'running_not_connected');
  assert.deepEqual(seen, ['running_not_connected']);
});

test('sends a request envelope with a correlation id and resolves on its response', async () => {
  const { client, socket } = connected();
  const pending = client.call('notify', 'targets', {});

  const frame = socket.last();
  assert.equal(frame['type'], 'request');
  assert.equal(frame['service'], 'notify');
  assert.equal(frame['method'], 'targets');
  assert.equal(typeof frame['id'], 'string');

  socket.receive({ type: 'response', id: frame['id'], ok: true, result: { targets: [] } });
  assert.deepEqual(await pending, { targets: [] });
});

test('multiplexes: responses out of order still land on the right call', async () => {
  const { client, socket } = connected();
  const first = client.call('notify', 'send', { title: 'slow' });
  const second = client.call('notify', 'targets');
  const [slowId, quickId] = socket.sent.map((text) => (JSON.parse(text) as { id: string }).id);

  socket.receive({ type: 'response', id: quickId, ok: true, result: 'quick' });
  socket.receive({ type: 'response', id: slowId, ok: true, result: 'slow' });

  assert.equal(await first, 'slow');
  assert.equal(await second, 'quick');
});

test('an error response rejects with the daemon’s own code and message', async () => {
  const { client, socket } = connected();
  const pending = client.call('notify', 'send', { title: '' });
  socket.receive({
    type: 'response',
    id: socket.last()['id'],
    ok: false,
    error: { code: 'bad_request', message: '`title` must not be empty' },
  });

  await pending.then(
    () => assert.fail('should have rejected'),
    (error: unknown) => {
      assert.ok(error instanceof NativeRequestError);
      assert.equal(error.code, 'bad_request');
      assert.match(error.message, /`title` must not be empty/);
    },
  );
});

test('notify resolves instead of rejecting when the bridge is gone', async () => {
  vi.useFakeTimers();
  const client = new NativeClient(silentLogger);
  const pending = client.notify({ title: 'x' });
  await vi.advanceTimersByTimeAsync(5_000);
  assert.deepEqual(await pending, { ok: false, delivered: [], failed: [] });
});

test('targets resolves to an empty list rather than throwing', async () => {
  vi.useFakeTimers();
  const client = new NativeClient(silentLogger);
  const pending = client.targets();
  await vi.advanceTimersByTimeAsync(5_000);
  assert.deepEqual(await pending, []);
});

test('a rejected request does not mark a healthy bridge as gone', async () => {
  const { client, socket } = connected();
  const pending = client.notify({ title: '' });
  socket.receive({
    type: 'response',
    id: socket.last()['id'],
    ok: false,
    error: { code: 'bad_request', message: 'no' },
  });
  assert.equal((await pending).ok, false);
  assert.equal(client.status, 'connected', 'a bad_request means the daemon answered');
});

test('the daemon going away rejects every in-flight call with a transport error', async () => {
  const { client, socket } = connected();
  const pending = client.call('notify', 'send', { title: 'x' });
  const rejected = assert.rejects(pending, NativeTransportError);
  socket.drop();
  await rejected;
});

test('a call made while reconnecting waits for the socket instead of failing at once', async () => {
  vi.useFakeTimers();
  const { client, socket } = connected();
  socket.drop();

  const pending = client.call('notify', 'targets');
  await tick();
  const next = FakeSocket.instances.at(-1);
  assert.ok(next && next !== socket, 'the call should have forced a reconnect');
  next.open();
  await tick();
  next.receive({ type: 'response', id: next.last()['id'], ok: true, result: 'ok' });
  assert.equal(await pending, 'ok');
});

test('a call times out rather than hanging forever', async () => {
  vi.useFakeTimers();
  const { client } = connected();
  const pending = client.call('notify', 'send', { title: 'x' });
  const rejected = assert.rejects(pending, /timed out/);
  await vi.advanceTimersByTimeAsync(4_100);
  await rejected;
});

test('mirrors sink records as a logs batch, seeding from what was already logged', async () => {
  vi.useFakeTimers();
  const sink = new LogSink();
  sink.write('info', 'host', 'booted', []);
  const { client, socket } = connected();
  client.mirrorLogs(sink);
  sink.write('warn', 'my-plugin', 'later', []);
  await vi.advanceTimersByTimeAsync(300);

  const batch = socket.last();
  assert.equal(batch['type'], 'logs');
  const records = batch['records'] as { scope: string; message: string; level: string }[];
  assert.deepEqual(
    records.map((record) => [record.level, record.scope, record.message]),
    [['info', 'host', 'booted'], ['warn', 'my-plugin', 'later']],
  );
});

test('queues log records while disconnected and flushes on open', async () => {
  vi.useFakeTimers();
  const sink = new LogSink();
  const client = new NativeClient(silentLogger);
  client.mirrorLogs(sink);
  sink.write('info', 'host', 'while down', []);
  await vi.advanceTimersByTimeAsync(300);

  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.equal((socket.last()['records'] as unknown[]).length, 1);
});

test('shows pushed daemon log lines in the sink under the bridge scope, and never echoes them', async () => {
  vi.useFakeTimers();
  const sink = new LogSink();
  const { client, socket } = connected();
  client.mirrorLogs(sink);
  socket.receive({
    type: 'push',
    event: 'log',
    data: { level: 'warn', scope: 'bridge', message: 'wayvr sink unavailable', ts: 1 },
  });

  const record = sink.records.at(-1);
  assert.ok(record);
  assert.equal(record.scope, 'bridge');
  assert.equal(record.level, 'warn');
  assert.equal(record.message, 'wayvr sink unavailable');

  await vi.advanceTimersByTimeAsync(300);
  assert.ok(
    socket.sent.every((text) => !text.includes('wayvr sink unavailable')),
    'the daemon’s own line must not be mirrored back to it',
  );
});

test('ready resolves once and is shared, not re-probed per reader', async () => {
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  };
  const client = new NativeClient(silentLogger);

  const [first, second] = await Promise.all([client.ready, client.ready]);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(calls, 1, 'both readers must share one probe');
});

test('setEndpoint moves the socket and re-probes', async () => {
  const seen: string[] = [];
  globalThis.fetch = ((url: string) => {
    seen.push(url);
    return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  }) as typeof globalThis.fetch;
  const { client, socket } = connected();

  assert.equal(await client.setEndpoint('http://127.0.0.1:9999/'), true);
  assert.equal(client.endpoint, 'http://127.0.0.1:9999');
  assert.equal(socket.readyState, FakeSocket.CLOSED, 'the old socket is closed');
  assert.equal(FakeSocket.instances.at(-1)?.url, 'ws://127.0.0.1:9999/v1/ws');
  assert.ok(seen.at(-1)?.startsWith('http://127.0.0.1:9999/v1/health'));
});

test('an empty endpoint falls back to the default rather than producing a bare path', async () => {
  healthOk();
  const client = new NativeClient(silentLogger);
  await client.setEndpoint('   ');
  assert.equal(client.endpoint, 'http://127.0.0.1:42081');
});

test('dispose closes the socket and stops reconnecting', () => {
  vi.useFakeTimers();
  const { client, socket } = connected();
  const before = FakeSocket.instances.length;
  client.dispose();
  assert.equal(socket.readyState, FakeSocket.CLOSED);
  vi.advanceTimersByTime(60_000);
  assert.equal(FakeSocket.instances.length, before, 'no reconnect after dispose');
});
