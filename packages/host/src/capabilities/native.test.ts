/**
 * The companion's absence is the common case, so "degrades cleanly" is the property worth testing.
 * A rejected promise here would surface as an unhandled rejection inside whatever event handler a
 * plugin called `notify()` from.
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
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response): void {
  globalThis.fetch = ((url: string, init: RequestInit = {}) =>
    Promise.resolve(handler(url, init))) as typeof globalThis.fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

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

test('sends JSON content type, which is what forces the CORS preflight', async () => {
  let seen: RequestInit | undefined;
  stubFetch((_url, init) => {
    seen = init;
    return json({ ok: true, delivered: ['wayvr'], failed: [] });
  });

  await new NativeClient(silentLogger).notify({ title: 'x', sinks: ['wayvr'] });

  const headers = seen?.headers as Record<string, string> | undefined;
  assert.equal(headers?.['Content-Type'], 'application/json');
  assert.equal(seen?.method, 'POST');
});

test('passes sinks and overrides through untouched', async () => {
  let body: unknown;
  stubFetch((_url, init) => {
    body = JSON.parse(typeof init.body === 'string' ? init.body : '');
    return json({ ok: true, delivered: ['wayvr'], failed: [] });
  });

  await new NativeClient(silentLogger).notify({
    title: 'Friend online',
    sinks: ['wayvr'],
    overrides: { wayvr: { height: 220, opacity: 0.85 } },
  });

  assert.deepEqual(body, {
    title: 'Friend online',
    sinks: ['wayvr'],
    overrides: { wayvr: { height: 220, opacity: 0.85 } },
  });
});

test('surfaces the companion’s own error code and message', async () => {
  stubFetch(() =>
    json({ ok: false, error: { code: 'bad_request', message: '`title` must not be empty' } }, 400),
  );

  await assert.rejects(
    () => new NativeClient(silentLogger).call('notify', 'send', { title: '' }),
    /bad_request: `title` must not be empty/,
  );
});

test('trims a trailing slash so the endpoint is not doubled', () => {
  assert.equal(
    new NativeClient(silentLogger, 'http://127.0.0.1:42081/').endpoint,
    'http://127.0.0.1:42081',
  );
});

test('a rejected request does not mark a healthy companion as gone', async () => {
  stubFetch(() =>
    json({ ok: false, error: { code: 'bad_request', message: '`title` must not be empty' } }, 400),
  );
  const client = new NativeClient(silentLogger);

  const result = await client.notify({ title: '' });
  assert.equal(result.ok, false);
  assert.equal(
    client.available,
    true,
    'a 400 means the daemon answered — it is running, the request was wrong',
  );
});

test('a transport failure does mark it gone', async () => {
  const client = new NativeClient(silentLogger);
  stubFetch(() => json({ ok: true, version: '0.1.0', services: [] }));
  await client.probe();
  assert.equal(client.available, true);

  globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  await client.notify({ title: 'x' });
  assert.equal(client.available, false);
});

test('call() rejects with a typed error carrying the companion’s code and status', async () => {
  stubFetch(() => json({ ok: false, error: { code: 'rate_limited', message: 'too many' } }, 429));

  await new NativeClient(silentLogger).call('notify', 'send', {}).then(
    () => assert.fail('should have rejected'),
    (error: unknown) => {
      assert.ok(error instanceof NativeRequestError);
      assert.equal(error.code, 'rate_limited');
      assert.equal(error.status, 429);
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
  const realWs = globalThis.WebSocket;
  try {
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      readyState = 1; // OPEN
      readonly sent: string[] = [];
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        sockets.push(this);
        setTimeout(() => { this.dispatchEvent(new Event('open')); }, 0);
      }
      send(data: string): void {
        this.sent.push(data);
        const parsed = JSON.parse(data) as { type: string; id: string; service: string; method: string };
        if (parsed.type === 'request') {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'response',
                  id: parsed.id,
                  ok: true,
                  result: { answer: 42 },
                }),
              }),
            );
          }, 0);
        }
      }
      close(): void {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }

    // @ts-expect-error Mock socket
    globalThis.WebSocket = FakeSocket;

    const client = new NativeClient(silentLogger);
    client.connectWs();
    const activeSocket = sockets[0];
    assert.ok(activeSocket !== undefined);
    assert.equal(client.connected, true);
    assert.equal(client.status, 'connected');

    const result = await client.call('math', 'compute', { x: 1 });
    assert.deepEqual(result, { answer: 42 });

    const sent = JSON.parse(activeSocket.sent[0] ?? '{}') as Record<string, unknown>;
    assert.equal(sent['type'], 'request');
    assert.equal(sent['service'], 'math');
    assert.equal(sent['method'], 'compute');
    assert.ok(typeof sent['id'] === 'string' && sent['id'].startsWith('req-'));

    client.dispose();
  } finally {
    globalThis.WebSocket = realWs;
  }
});

test('handles multiplexed concurrent calls and error responses over WebSocket', async () => {
  const realWs = globalThis.WebSocket;
  try {
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      readyState = 1;
      readonly sent: string[] = [];
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        sockets.push(this);
      }
      send(data: string): void {
        this.sent.push(data);
      }
      close(): void {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }

    // @ts-expect-error Mock socket
    globalThis.WebSocket = FakeSocket;

    const client = new NativeClient(silentLogger);
    client.connectWs();
    const activeSocket = sockets[0];
    assert.ok(activeSocket !== undefined);

    const call1 = client.call('svc', 'm1', {});
    const call2 = client.call('svc', 'm2', {});

    assert.equal(activeSocket.sent.length, 2);
    const req1 = JSON.parse(activeSocket.sent[0] ?? '{}') as { id: string };
    const req2 = JSON.parse(activeSocket.sent[1] ?? '{}') as { id: string };

    // Reply to req2 with failure
    activeSocket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'response',
          id: req2.id,
          ok: false,
          error: { code: 'bad_request', message: 'oops' },
        }),
      }),
    );

    // Reply to req1 with success
    activeSocket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'response',
          id: req1.id,
          ok: true,
          result: 'ok1',
        }),
      }),
    );

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
  } finally {
    globalThis.WebSocket = realWs;
  }
});

test('streams logs and dispatches log broadcasts over WebSocket', () => {
  const realWs = globalThis.WebSocket;
  try {
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      readyState = 1;
      readonly sent: string[] = [];
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        sockets.push(this);
      }
      send(data: string): void {
        this.sent.push(data);
      }
      close(): void {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }

    // @ts-expect-error Mock socket
    globalThis.WebSocket = FakeSocket;

    const client = new NativeClient(silentLogger);
    client.connectWs();
    const activeSocket = sockets[0];
    assert.ok(activeSocket !== undefined);

    const receivedBroadcasts: unknown[] = [];
    const unsubscribe = client.onLogBroadcast((records) => {
      receivedBroadcasts.push(...records);
    });

    // Test sendLogs
    const sent = client.sendLogs([{ level: 'info', scope: 'app', message: 'hi' }]);
    assert.equal(sent, true);
    const sentMsg = JSON.parse(activeSocket.sent[0] ?? '{}') as { type: string; records: unknown[] };
    assert.equal(sentMsg.type, 'logs');
    assert.equal(sentMsg.records.length, 1);

    // Test broadcast push
    activeSocket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'push',
          event: 'logBroadcast',
          data: [{ level: 'warn', scope: 'bridge', message: 'daemon warning' }],
        }),
      }),
    );

    assert.equal(receivedBroadcasts.length, 1);
    assert.deepEqual(receivedBroadcasts[0], {
      level: 'warn',
      scope: 'bridge',
      message: 'daemon warning',
    });

    unsubscribe();
    client.dispose();
  } finally {
    globalThis.WebSocket = realWs;
  }
});

