/**
 * The two gated members whose behaviour is not simply "await the prompt, then call through":
 * `vrchat.self()`, which cannot await anything, and `http.fetch`, which leaves this machine
 * through the bridge when one is connected.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  DisposableBag,
  PermissionError,
  parsePluginManifest,
  type DeepLinkApi,
  type DeepLinkPrefix,
  type Logger,
  type PluginManifest,
  type VrchatApi,
  type VrcSelf,
} from '@vrcnext/plugin-api';

import type { BridgeClient } from '../capabilities/native.js';

import { PermissionBroker } from '../permissions/broker.js';
import type { Decision } from '../permissions/types.js';
import { GrantStore } from '../permissions/grant-store.js';
import { PluginGate } from '../permissions/plugin-gate.js';
import { MemoryStateService } from '../state/state-service.js';
import { GatedDeepLinks, GatedHttp, gatedVrchat } from './gated.js';

const logger: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, scoped: () => logger };

const SELF = { id: 'usr_1', displayName: 'Blu' } as unknown as VrcSelf;

/** The prompt resolves through the broker's queue, which takes a few turns of the loop. */
function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function manifest(): PluginManifest {
  const { manifest: parsed } = parsePluginManifest({
    id: 'bio-updater',
    name: 'Bio Updater',
    version: '1.0.0',
    apiVersion: '^0.3.0',
    permissions: ['vrchat'],
  });
  assert.ok(parsed);
  return parsed;
}

function fixture(): { api: VrchatApi; asked: string[] } {
  const asked: string[] = [];
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: { ask: (request) => { asked.push(request.title); return Promise.resolve('allow'); } },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const inner = { self: () => SELF } as unknown as VrchatApi;
  return { api: gatedVrchat(inner, new PluginGate(manifest(), broker, logger, new AbortController().signal)), asked };
}

test('self() starts the permission prompt instead of silently answering undefined forever', async () => {
  const f = fixture();
  assert.equal(f.api.self(), undefined, 'the first read cannot wait for the answer');
  await settle();
  assert.equal(f.asked.length, 1, 'the user was asked');
  assert.equal(f.api.self(), SELF, 'the next read sees the account');
});

test('repeated reads before the answer ask only once', async () => {
  const f = fixture();
  f.api.self();
  f.api.self();
  f.api.self();
  await settle();
  assert.equal(f.asked.length, 1);
});

function httpManifest(): PluginManifest {
  const { manifest: parsed } = parsePluginManifest({
    id: 'bio-updater',
    name: 'Bio Updater',
    version: '1.0.0',
    apiVersion: '^0.3.0',
    permissions: ['network'],
    hosts: ['api.steampowered.com'],
  });
  assert.ok(parsed);
  return parsed;
}

/** A bridge that is connected and records what `outbound.fetch` was asked for. */
function fakeBridge(reply: unknown): { bridge: BridgeClient; calls: { service: string; params: unknown }[] } {
  const calls: { service: string; params: unknown }[] = [];
  const bridge = {
    status: 'connected',
    call: (service: string, _method: string, params: unknown) => {
      calls.push({ service, params });
      return Promise.resolve(reply);
    },
  } as unknown as BridgeClient;
  return { bridge, calls };
}

function http(answer: Decision, reply: unknown): { api: GatedHttp; asked: string[]; calls: { service: string; params: unknown }[] } {
  const asked: string[] = [];
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: { ask: (request) => { asked.push(request.title); return Promise.resolve(answer); } },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const gate = new PluginGate(httpManifest(), broker, logger, new AbortController().signal);
  gate.seedDeclared();
  const { bridge, calls } = fakeBridge(reply);
  return { api: new GatedHttp(gate, new AbortController().signal, bridge), asked, calls };
}

const OK_REPLY = {
  status: 200,
  statusText: 'OK',
  url: 'https://api.steampowered.com/x',
  headers: { 'content-type': 'application/json' },
  body: '{"response":{}}',
};

test('a host declared in plugin.json is still asked about, because the bridge reaches further than the page', async () => {
  const f = http('allow', OK_REPLY);
  const response = await f.api.fetch('https://api.steampowered.com/x');
  assert.deepEqual(f.asked, ['Plugin Bio Updater (bio-updater) wants to request data from api.steampowered.com']);
  assert.equal(response.status, 200);
  assert.equal(response.url, 'https://api.steampowered.com/x');
  assert.equal(await response.text(), '{"response":{}}');
});

test('the request goes to the bridge, not the page, and carries method and headers', async () => {
  const f = http('allow', OK_REPLY);
  await f.api.fetch('https://api.steampowered.com/x', { method: 'post', headers: { 'X-Key': 'abc' }, body: 'hi' });
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.ok(call);
  assert.equal(call.service, 'outbound');
  assert.deepEqual(call.params, {
    url: 'https://api.steampowered.com/x',
    method: 'POST',
    headers: { 'x-key': 'abc' },
    body: 'hi',
  });
});

test('a denied host reaches neither the bridge nor the page', async () => {
  const f = http('deny', OK_REPLY);
  await assert.rejects(() => f.api.fetch('https://api.steampowered.com/x'));
  assert.deepEqual(f.calls, []);
});

test('a non-http scheme is refused before the user is troubled with it', async () => {
  const f = http('allow', OK_REPLY);
  await assert.rejects(() => f.api.fetch('file:///etc/passwd'));
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.calls, []);
});

test('a 3xx from the bridge is surfaced as-is, Location and all', async () => {
  const f = http('allow', { status: 302, statusText: 'Found', url: '', headers: { location: 'https://elsewhere.example/' }, body: '' });
  const response = await f.api.fetch('https://api.steampowered.com/x');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://elsewhere.example/');
  assert.equal(response.url, 'https://api.steampowered.com/x');
});

function hangingHttp(lifetime: AbortSignal): { api: GatedHttp; seen: (AbortSignal | undefined)[] } {
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: { ask: () => Promise.resolve('allow') },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const gate = new PluginGate(httpManifest(), broker, logger, new AbortController().signal);
  const seen: (AbortSignal | undefined)[] = [];
  const bridge = {
    status: 'connected',
    call: (_service: string, _method: string, _params: unknown, options?: { signal?: AbortSignal }) => {
      seen.push(options?.signal);
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
      });
    },
  } as unknown as BridgeClient;
  return { api: new GatedHttp(gate, lifetime, bridge), seen };
}

test("the caller's signal cancels a bridge request with an AbortError", async () => {
  const f = hangingHttp(new AbortController().signal);
  const controller = new AbortController();
  const pending = f.api.fetch('https://api.steampowered.com/x', { signal: controller.signal });
  await settle();
  assert.equal(f.seen.length, 1);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test("the plugin's lifetime signal cancels a bridge request too", async () => {
  const lifetime = new AbortController();
  const f = hangingHttp(lifetime.signal);
  const pending = f.api.fetch('https://api.steampowered.com/x');
  await settle();
  lifetime.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('an already-aborted signal never reaches the bridge', async () => {
  const f = hangingHttp(new AbortController().signal);
  await assert.rejects(f.api.fetch('https://api.steampowered.com/x', { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.deepEqual(f.seen, []);
});

test('deep links need openDeepLink in plugin.json "events", like the event itself', () => {
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: { ask: () => Promise.resolve('allow') },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const gate = new PluginGate(httpManifest(), broker, logger, new AbortController().signal);
  const inner = { on: () => () => undefined, onPrefix: () => () => undefined } as unknown as DeepLinkApi;
  const links = new GatedDeepLinks(inner, gate, new DisposableBag());
  assert.throws(() => links.on(() => undefined), PermissionError);
  assert.throws(() => links.onPrefix('vrcnext://x' as DeepLinkPrefix, () => undefined), PermissionError);

  const { manifest: declared } = parsePluginManifest({
    id: 'linker', name: 'Linker', version: '1.0.0', apiVersion: '^0.3.0',
    permissions: ['host:events'], events: ['openDeepLink'],
  });
  assert.ok(declared);
  const allowed = new GatedDeepLinks(inner, new PluginGate(declared, broker, logger, new AbortController().signal), new DisposableBag());
  allowed.on(() => undefined)();
});
