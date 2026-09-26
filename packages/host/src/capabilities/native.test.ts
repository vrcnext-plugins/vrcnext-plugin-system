/**
 * The bridge client's contract with the daemon: the hello is the first frame, nothing is sent
 * before the welcome, a refused pairing stops the retry loop, and calls multiplex over one
 * socket. The socket is faked at the `WebSocket` global and driven by hand.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Logger } from '@vrcnext/plugin-api';

import { LogSink } from '../log/log-sink.js';
import {
  BridgeClient,
  NativeRequestError,
  NativeTransportError,
  type BridgeStatus,
} from './native.js';
import { CLOSE_POLICY_VIOLATION } from './native-socket.js';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  scoped: () => silentLogger,
};

type Listener = (event: { readonly data?: unknown; readonly code?: number; readonly reason?: string }) => void;

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
    this.#emit('close', { code: 1000, reason: '' });
  }

  /** Test driver: the TCP connection is up; the client should now send its hello. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.#emit('open', {});
  }

  /** Test driver: the daemon accepted the hello. */
  welcome(services: Record<string, unknown> = { notify: {} }): void {
    this.receive({ type: 'welcome', version: '0.3.0', services });
  }

  /** Test driver: the daemon closed the socket. */
  drop(code = 1006, reason = ''): void {
    this.readyState = FakeSocket.CLOSED;
    this.#emit('close', { code, reason });
  }

  receive(frame: unknown): void {
    this.#emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  /** The last frame sent, parsed. */
  last(): Record<string, unknown> {
    return JSON.parse(this.sent.at(-1) ?? '{}') as Record<string, unknown>;
  }

  #emit(type: string, event: { readonly data?: unknown; readonly code?: number; readonly reason?: string }): void {
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
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ ok: true })));
}

function client(token = 'secret'): BridgeClient {
  return new BridgeClient(silentLogger, { endpoint: 'http://127.0.0.1:42081/', token, client: 'test/0' });
}

/** A client whose hello the daemon has accepted. */
function connected(): { client: BridgeClient; socket: FakeSocket } {
  const bridge = client();
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  socket.open();
  socket.welcome();
  return { client: bridge, socket };
}

const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

test('opens the socket at /v1/ws and sends the hello as the first frame', () => {
  const bridge = client();
  assert.equal(bridge.endpoint, 'http://127.0.0.1:42081');
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  assert.equal(socket.url, 'ws://127.0.0.1:42081/v1/ws');
  socket.open();
  assert.deepEqual(socket.last(), { type: 'hello', token: 'secret', client: 'test/0' });
  assert.equal(bridge.status, 'running_not_connected', 'open but not yet welcomed');
});

test('does not open a socket at all without a token, and reads as unpaired once probed', async () => {
  healthOk();
  const bridge = client('');
  assert.equal(FakeSocket.instances.length, 0);
  assert.equal(bridge.status, 'not_detected');
  await bridge.probe();
  assert.equal(bridge.status, 'unpaired');
});

test('is not_detected until something answers, then running_not_connected', async () => {
  const bridge = client();
  assert.equal(bridge.status, 'not_detected');
  assert.equal(await bridge.probe(), false);
  healthOk();
  assert.equal(await bridge.probe(), true);
  assert.equal(bridge.status, 'running_not_connected');
});

test('is connected once welcomed and caches the welcome for describe()', () => {
  const { client: bridge } = connected();
  assert.equal(bridge.status, 'connected');
  assert.equal(bridge.describe()?.version, '0.3.0');
  assert.deepEqual(Object.keys(bridge.describe()?.services ?? {}), ['notify']);
});

test('a close with 1008 means unpaired and no reconnect is scheduled', () => {
  vi.useFakeTimers();
  const bridge = client();
  const seen: BridgeStatus[] = [];
  bridge.onStatus((status) => { seen.push(status); });
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  socket.open();
  socket.drop(CLOSE_POLICY_VIOLATION, 'unauthorized');
  assert.equal(bridge.status, 'unpaired');
  assert.deepEqual(seen, ['running_not_connected', 'unpaired']);
  vi.advanceTimersByTime(60_000);
  assert.equal(FakeSocket.instances.length, 1, 'a refused pairing must not be retried');
});

test('setToken persists nothing on failure but reconnects with the new token', () => {
  const bridge = client();
  const first = FakeSocket.instances.at(-1);
  assert.ok(first);
  first.open();
  first.drop(CLOSE_POLICY_VIOLATION, 'unauthorized');
  bridge.setToken('  better  ');
  const second = FakeSocket.instances.at(-1);
  assert.ok(second && second !== first);
  second.open();
  assert.equal(second.last()['token'], 'better');
  assert.equal(bridge.token, 'better');
});

test('drops back and reconnects when the daemon goes away for any other reason', () => {
  vi.useFakeTimers();
  const { client: bridge, socket } = connected();
  socket.drop();
  assert.notEqual(bridge.status, 'connected');
  vi.advanceTimersByTime(1_100);
  assert.equal(FakeSocket.instances.length, 2, 'a normal close is retried');
});

test('sends a request envelope with a correlation id and resolves on its response', async () => {
  const { client: bridge, socket } = connected();
  const pending = bridge.call('notify', 'targets', {});

  const frame = socket.last();
  assert.equal(frame['type'], 'request');
  assert.equal(frame['service'], 'notify');
  assert.equal(frame['method'], 'targets');
  assert.equal(typeof frame['id'], 'string');

  socket.receive({ type: 'response', id: frame['id'], ok: true, result: { targets: [] } });
  assert.deepEqual(await pending, { targets: [] });
});

test('multiplexes: responses out of order still land on the right call', async () => {
  const { client: bridge, socket } = connected();
  const first = bridge.call('notify', 'send', { title: 'slow' });
  const second = bridge.call('notify', 'targets');
  const ids = socket.sent.slice(1).map((text) => (JSON.parse(text) as { id: string }).id);

  socket.receive({ type: 'response', id: ids[1], ok: true, result: 'quick' });
  socket.receive({ type: 'response', id: ids[0], ok: true, result: 'slow' });

  assert.equal(await first, 'slow');
  assert.equal(await second, 'quick');
});

test('an error response rejects with the daemon’s own code and message', async () => {
  const { client: bridge, socket } = connected();
  const pending = bridge.call('plugins', 'install', { url: 'http://x' });
  socket.receive({
    type: 'response',
    id: socket.last()['id'],
    ok: false,
    error: { code: 'bad_request', message: 'not_https: use an https:// url' },
  });

  await pending.then(
    () => assert.fail('should have rejected'),
    (error: unknown) => {
      assert.ok(error instanceof NativeRequestError);
      assert.equal(error.code, 'bad_request');
      assert.match(error.message, /not_https/);
    },
  );
});

test('the daemon going away rejects every in-flight call with a transport error', async () => {
  const { client: bridge, socket } = connected();
  const pending = bridge.call('notify', 'send', { title: 'x' });
  const rejected = assert.rejects(pending, NativeTransportError);
  socket.drop();
  await rejected;
});

test('a call made while reconnecting waits for the welcome instead of failing at once', async () => {
  vi.useFakeTimers();
  const { client: bridge, socket } = connected();
  socket.drop();

  const pending = bridge.call('notify', 'targets');
  await tick();
  const next = FakeSocket.instances.at(-1);
  assert.ok(next && next !== socket, 'the call should have forced a reconnect');
  next.open();
  assert.equal(next.sent.length, 1, 'only the hello goes out before the welcome');
  next.welcome();
  await tick();
  next.receive({ type: 'response', id: next.last()['id'], ok: true, result: 'ok' });
  assert.equal(await pending, 'ok');
});

test('a call times out at the default, and a per-call timeout overrides it', async () => {
  vi.useFakeTimers();
  const { client: bridge } = connected();
  const quick = bridge.call('notify', 'send', { title: 'x' });
  const slow = bridge.call('plugins', 'install', { url: 'https://x' }, { timeoutMs: 130_000 });
  const quickRejected = assert.rejects(quick, /timed out/);
  let slowSettled = false;
  void slow.catch(() => { slowSettled = true; });
  await vi.advanceTimersByTimeAsync(4_100);
  await quickRejected;
  assert.equal(slowSettled, false, 'the long call is still waiting for the desktop confirmation');
  await vi.advanceTimersByTimeAsync(130_000);
  assert.equal(slowSettled, true);
});

test('mirrors sink records as a logs batch, seeding from what was already logged', async () => {
  vi.useFakeTimers();
  const sink = new LogSink();
  sink.write('info', 'host', 'booted', []);
  const { client: bridge, socket } = connected();
  bridge.mirrorLogs(sink);
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

test('queues log records while disconnected and flushes only after the welcome', async () => {
  vi.useFakeTimers();
  const sink = new LogSink();
  const bridge = client();
  bridge.mirrorLogs(sink);
  sink.write('info', 'host', 'while down', []);
  await vi.advanceTimersByTimeAsync(300);

  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  socket.open();
  assert.equal(socket.sent.length, 1, 'hello only');
  socket.welcome();
  assert.equal((socket.last()['records'] as unknown[]).length, 1);
});

test('shows pushed daemon log lines under the bridge scope, never echoing them, and fans out other pushes', async () => {
  vi.useFakeTimers();
  const sink = new LogSink();
  const { client: bridge, socket } = connected();
  bridge.mirrorLogs(sink);
  const pushes: string[] = [];
  bridge.onPush((event) => { pushes.push(event); });

  socket.receive({ type: 'push', event: 'log', data: { level: 'warn', scope: 'bridge', message: 'wayvr sink unavailable', ts: 1 } });
  socket.receive({ type: 'push', event: 'build', data: { ok: true } });

  const record = sink.records.at(-1);
  assert.ok(record);
  assert.equal(record.scope, 'bridge');
  assert.equal(record.message, 'wayvr sink unavailable');
  assert.deepEqual(pushes, ['build']);

  await vi.advanceTimersByTimeAsync(300);
  assert.ok(socket.sent.every((text) => !text.includes('wayvr sink unavailable')));
});

test('setEndpoint moves the socket and re-probes', async () => {
  const seen: string[] = [];
  globalThis.fetch = ((url: string) => {
    seen.push(url);
    return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  }) as typeof globalThis.fetch;
  const { client: bridge, socket } = connected();

  bridge.setEndpoint('http://127.0.0.1:9999/');
  await Promise.resolve();
  assert.equal(bridge.endpoint, 'http://127.0.0.1:9999');
  assert.equal(socket.readyState, FakeSocket.CLOSED, 'the old socket is closed');
  assert.equal(FakeSocket.instances.at(-1)?.url, 'ws://127.0.0.1:9999/v1/ws');
  assert.ok(seen.at(-1)?.startsWith('http://127.0.0.1:9999/v1/health'));
});

test('dispose closes the socket and stops reconnecting', () => {
  vi.useFakeTimers();
  const { client: bridge, socket } = connected();
  const before = FakeSocket.instances.length;
  bridge.dispose();
  assert.equal(socket.readyState, FakeSocket.CLOSED);
  vi.advanceTimersByTime(60_000);
  assert.equal(FakeSocket.instances.length, before, 'no reconnect after dispose');
});
