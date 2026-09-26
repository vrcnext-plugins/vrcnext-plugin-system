/**
 * The companion's absence is the common case, so "degrades cleanly" is the property worth testing.
 * A rejected promise here would surface as an unhandled rejection inside whatever event handler a
 * plugin called `notify()` from.
 *
 * Health is the one HTTP call and is stubbed through `fetch`; everything else goes over the
 * WebSocket, which is stubbed with {@link FakeSocket}.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import type { Logger } from '@vrcnext/plugin-api';

import { NativeClient, NativeRequestError } from './native.js';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  scoped: () => silentLogger,
};

const realFetch = globalThis.fetch;
const realWs = globalThis.WebSocket;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWs;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response): void {
  globalThis.fetch = ((url: string, init: RequestInit = {}) =>
    Promise.resolve(handler(url, init))) as typeof globalThis.fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface RequestFrame {
  readonly type: string;
  readonly id: string;
  readonly service: string;
  readonly method: string;
  readonly params: unknown;
}

/** Answers every request frame with `respond(frame)`, or leaves it pending when it returns undefined. */
class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  static respond: (frame: RequestFrame) => Record<string, unknown> | undefined = () => undefined;

  readyState = 1; // OPEN
  readonly sent: string[] = [];
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.instances.push(this);
    setTimeout(() => { this.dispatchEvent(new Event('open')); }, 0);
  }

  send(data: string): void {
    this.sent.push(data);
    const frame = JSON.parse(data) as RequestFrame;
    if (frame.type !== 'request') return;
    const reply = FakeSocket.respond(frame);
    if (reply === undefined) return;
    setTimeout(() => { this.reply({ type: 'response', id: frame.id, ...reply }); }, 0);
  }

  reply(message: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  requests(): RequestFrame[] {
    return this.sent.map((s) => JSON.parse(s) as RequestFrame).filter((f) => f.type === 'request');
  }
}

function installFakeSocket(
  respond: (frame: RequestFrame) => Record<string, unknown> | undefined = () => undefined,
): void {
  FakeSocket.instances = [];
  FakeSocket.respond = respond;
  // @ts-expect-error Mock socket
  globalThis.WebSocket = FakeSocket;
}

/** A client whose health answered and whose WebSocket is open. */
function connectedClient(): { client: NativeClient; socket: FakeSocket } {
  const client = new NativeClient(silentLogger);
  client.connectWs();
  const socket = FakeSocket.instances[0];
  assert.ok(socket !== undefined);
  return { client, socket };
}

const ok = { ok: true, result: { ok: true, delivered: ['wayvr'], failed: [] } };
const badRequest = { ok: false, error: { code: 'bad_request', message: '`title` must not be empty' } };

test('reports unavailable when nothing is listening', async () => {
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const client = new NativeClient(silentLogger);

  assert.equal(await client.probe(), false);
  assert.equal(client.available, false);
});

test('notify resolves instead of rejecting when the companion is gone', async () => {
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const client = new NativeClient(silentLogger);

  const result = await client.notify({ title: 'x' });
  assert.deepEqual(result, { ok: false, delivered: [], failed: [] });
});

test('targets resolves to an empty list rather than throwing', async () => {
  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  assert.deepEqual(await new NativeClient(silentLogger).targets(), []);
});

test('becomes available once health answers', async () => {
  stubFetch(() => json({ ok: true, version: '0.1.0', services: ['notify'] }));
  const client = new NativeClient(silentLogger);

  assert.equal(await client.probe(), true);
  assert.equal(client.available, true);
});

test('notify is a request frame for notify/send over the WebSocket', async () => {
  installFakeSocket(() => ok);
  const { client, socket } = connectedClient();

  await client.notify({ title: 'x', sinks: ['wayvr'] });

  const [frame] = socket.requests();
  assert.ok(frame !== undefined);
  assert.equal(frame.service, 'notify');
  assert.equal(frame.method, 'send');
  client.dispose();
});

test('passes sinks and overrides through untouched', async () => {
  installFakeSocket(() => ok);
  const { client, socket } = connectedClient();

  await client.notify({
    title: 'Friend online',
    sinks: ['wayvr'],
    overrides: { wayvr: { height: 220, opacity: 0.85 } },
  });

  assert.deepEqual(socket.requests()[0]?.params, {
    title: 'Friend online',
    sinks: ['wayvr'],
    overrides: { wayvr: { height: 220, opacity: 0.85 } },
  });
  client.dispose();
});

test('surfaces the companion’s own error code and message', async () => {
  installFakeSocket(() => badRequest);
  const { client } = connectedClient();

  await assert.rejects(
    () => client.call('notify', 'send', { title: '' }),
    /bad_request: `title` must not be empty/,
  );
  client.dispose();
});

test('trims a trailing slash so the endpoint is not doubled', () => {
  assert.equal(
    new NativeClient(silentLogger, 'http://127.0.0.1:42081/').endpoint,
    'http://127.0.0.1:42081',
  );
});

test('a rejected request does not mark a healthy companion as gone', async () => {
  stubFetch(() => json({ ok: true, version: '0.1.0', services: [] }));
  installFakeSocket(() => badRequest);
  const client = new NativeClient(silentLogger);
  await client.probe();

  const result = await client.notify({ title: '' });
  assert.equal(result.ok, false);
  assert.equal(
    client.available,
    true,
    'a rejected frame means the daemon answered — it is running, the request was wrong',
  );
  client.dispose();
});

test('a transport failure does mark it gone', async () => {
  stubFetch(() => json({ ok: true, version: '0.1.0', services: [] }));
  installFakeSocket(() => ok);
  const client = new NativeClient(silentLogger);
  await client.probe();
  assert.equal(client.available, true);

  FakeSocket.instances[0]?.close();
  await client.notify({ title: 'x' });
  assert.equal(client.available, false);
  client.dispose();
});

test('a request timeout is a transport failure, not a companion refusal', () => {
  const error = new NativeRequestError('timeout', 504, 'request timed out');
  assert.ok(error.status >= 500);
  assert.equal(error.message, 'timeout: request timed out');
});

test('call() rejects with a typed error carrying the companion’s code', async () => {
  installFakeSocket(() => ({ ok: false, error: { code: 'rate_limited', message: 'too many' } }));
  const { client } = connectedClient();

  await client.call('notify', 'send', {}).then(
    () => assert.fail('should have rejected'),
    (error: unknown) => {
      assert.ok(error instanceof NativeRequestError);
      assert.equal(error.code, 'rate_limited');
      assert.equal(error.status, 400, 'the WebSocket protocol has no status; a refusal is a 400');
    },
  );
  client.dispose();
});

test('call() rejects with unavailable while the socket is not open', async () => {
  const client = new NativeClient(silentLogger);
  await client.call('notify', 'send', {}).then(
    () => assert.fail('should have rejected'),
    (error: unknown) => {
      assert.ok(error instanceof NativeRequestError);
      assert.equal(error.code, 'unavailable');
      assert.equal(error.status, 503);
    },
  );
});

test('ready resolves once and is shared, not re-probed per reader', async () => {
  let calls = 0;
  stubFetch(() => {
    calls += 1;
    return json({ ok: true, version: '0.1.0', services: [] });
  });
  const client = new NativeClient(silentLogger);

  const [first, second] = await Promise.all([client.ready, client.ready]);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(calls, 1, 'both readers must share one probe');
});

test('setEndpoint moves the client and re-probes', async () => {
  const seen: string[] = [];
  stubFetch((url) => {
    seen.push(url);
    return json({ ok: true, version: '0.1.0', services: [] });
  });
  const client = new NativeClient(silentLogger);

  assert.equal(await client.setEndpoint('http://127.0.0.1:9999/'), true);
  assert.equal(client.endpoint, 'http://127.0.0.1:9999');
  assert.ok(seen.at(-1)?.startsWith('http://127.0.0.1:9999/v1/health'));
});

test('an empty endpoint falls back to the default rather than producing a bare path', async () => {
  stubFetch(() => json({ ok: true, version: '0.1.0', services: [] }));
  const client = new NativeClient(silentLogger);

  await client.setEndpoint('   ');
  assert.equal(client.endpoint, 'http://127.0.0.1:42081');
  assert.equal(client.wsUrl, 'ws://127.0.0.1:42081/v1/ws');
});

test('reports tri-state correctly for not_detected, running_not_connected, and connected', async () => {
  const client = new NativeClient(silentLogger);
  assert.equal(client.status, 'not_detected');
  assert.equal(client.running, false);
  assert.equal(client.connected, false);

  stubFetch(() => json({ ok: true, version: '0.1.0', services: [] }));
  await client.probe();
  // In Node test environment without global WebSocket open, it is running_not_connected
  assert.equal(client.running, true);
  assert.equal(client.status, 'running_not_connected');
});

test('multiplexes service calls over WebSocket with correlation IDs', async () => {
  installFakeSocket(() => ({ ok: true, result: { answer: 42 } }));
  const { client, socket } = connectedClient();
  assert.equal(client.connected, true);
  assert.equal(client.status, 'connected');

  const result = await client.call('math', 'compute', { x: 1 });
  assert.deepEqual(result, { answer: 42 });

  const [sent] = socket.requests();
  assert.ok(sent !== undefined);
  assert.equal(sent.type, 'request');
  assert.equal(sent.service, 'math');
  assert.equal(sent.method, 'compute');
  assert.ok(sent.id.startsWith('req-'));

  client.dispose();
});

test('handles multiplexed concurrent calls and error responses over WebSocket', async () => {
  installFakeSocket();
  const { client, socket } = connectedClient();

  const call1 = client.call('svc', 'm1', {});
  const call2 = client.call('svc', 'm2', {});

  const [req1, req2] = socket.requests();
  assert.ok(req1 !== undefined && req2 !== undefined);

  // Reply out of order: req2 fails first, then req1 succeeds.
  socket.reply({ type: 'response', id: req2.id, ok: false, error: { code: 'bad_request', message: 'oops' } });
  socket.reply({ type: 'response', id: req1.id, ok: true, result: 'ok1' });

  const [res1, err2] = await Promise.all([
    call1,
    call2.then(
      () => { assert.fail('should reject'); },
      (err: unknown) => err,
    ),
  ]);

  assert.equal(res1, 'ok1');
  assert.ok(err2 instanceof NativeRequestError);
  assert.equal(err2.code, 'bad_request');
  assert.equal(err2.message, 'bad_request: oops');

  client.dispose();
});

test('streams logs and dispatches log broadcasts over WebSocket', () => {
  installFakeSocket();
  const { client, socket } = connectedClient();

  const receivedBroadcasts: unknown[] = [];
  const unsubscribe = client.onLogBroadcast((records) => {
    receivedBroadcasts.push(...records);
  });

  const sent = client.sendLogs([{ level: 'info', scope: 'app', message: 'hi' }]);
  assert.equal(sent, true);
  const sentMsg = JSON.parse(socket.sent[0] ?? '{}') as { type: string; records: unknown[] };
  assert.equal(sentMsg.type, 'logs');
  assert.equal(sentMsg.records.length, 1);

  socket.reply({
    type: 'push',
    event: 'logBroadcast',
    data: [{ level: 'warn', scope: 'bridge', message: 'daemon warning' }],
  });

  assert.deepEqual(receivedBroadcasts, [{ level: 'warn', scope: 'bridge', message: 'daemon warning' }]);

  unsubscribe();
  client.dispose();
});

test('a stale socket closing after the endpoint moved does not tear down the live one', async () => {
  stubFetch(() => json({ ok: true, version: '0.1.0', services: [] }));
  installFakeSocket();
  const { client, socket: first } = connectedClient();

  await client.setEndpoint('http://127.0.0.1:9999');
  const live = FakeSocket.instances[1];
  assert.ok(live !== undefined && live !== first);
  assert.equal(client.connected, true);

  // A real socket reports its close asynchronously, so this arrives after the replacement.
  first.close();
  assert.equal(client.connected, true);
  client.dispose();
});
