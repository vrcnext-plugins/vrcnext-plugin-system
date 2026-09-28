/**
 * A plugin written for an older host still runs.
 *
 * The host used to refuse anything whose declared API range did not cover the running version,
 * which meant every minor release stopped working plugins for no reason the user could see or
 * act on. The range is now a warning; only an actual failure is a failure, and that one comes
 * with somewhere to send it.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { parsePluginManifest, type PluginManifest, type VrcnextPlugin } from '@vrcnext/plugin-api';

import { API_VERSION } from '../api-version.js';
import { MemoryStateService } from '../state/state-service.js';
import { LogSink } from '../log/log-sink.js';
import { PermissionBroker } from '../permissions/broker.js';
import { GrantStore } from '../permissions/grant-store.js';
import type { ContextDeps } from './context.js';
import { PluginManager } from './plugin-manager.js';
import { PluginStartupError } from './startup-error.js';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['window'] = dom.window;
  globals['document'] = dom.window.document;
  globals['location'] = dom.window.location;
});

afterEach(() => { dom.window.close(); });

/** A manifest declaring an API range this host does not satisfy. */
function manifestFor(overrides: Record<string, unknown>): PluginManifest {
  const { manifest, errors } = parsePluginManifest({
    id: 'old-timer',
    name: 'Old Timer',
    version: '1.0.0',
    apiVersion: '^0.1.0',
    homepage: 'https://github.com/vrcnext-plugins/vrcnext-example-plugin',
    ...overrides,
  });
  assert.deepEqual(errors, []);
  assert.ok(manifest);
  return manifest;
}

async function managerFor(manifest: PluginManifest, activate: () => void): Promise<{
  readonly manager: PluginManager;
  readonly logged: string[];
}> {
  const state = new MemoryStateService();
  await state.set('host', 'enabled:old-timer', true);
  const grants = new GrantStore(state);
  await grants.load();
  const logged: string[] = [];
  const sink = new LogSink();
  const context = {
    sink,
    state,
    broker: new PermissionBroker({
      grants,
      prompt: { ask: () => Promise.resolve('deny' as const) },
      onUninstall: () => Promise.resolve(),
      log: () => undefined,
    }),
    ui: { forPlugin: () => ({ kit: {}, disposeAll: () => undefined }) },
    vrchat: {},
    bridge: { send: () => undefined },
    router: { on: () => () => undefined },
    native: { describe: () => undefined, onPush: () => () => undefined, call: () => Promise.resolve({}) },
    gameLog: { onType: () => () => undefined },
    notifications: {},
    deepLinks: { register: () => () => undefined },
    routes: new Map(),
    origin: 'http://localhost',
    isLinux: () => true,
  } as unknown as ContextDeps;

  const plugin: VrcnextPlugin = { id: manifest.id, activate };
  const manager = new PluginManager({
    compiled: [{ manifest, plugin }],
    context,
    state,
    service: { list: () => Promise.resolve([]), updates: () => Promise.resolve([]) } as never,
    broker: context.broker,
    consent: { ask: () => Promise.resolve(true) },
    logger: {
      info: (message: string) => { logged.push(`info ${message}`); },
      warn: (message: string) => { logged.push(`warn ${message}`); },
      error: (message: string) => { logged.push(`error ${message}`); },
      debug: () => undefined,
      scoped: () => { throw new Error('not used by these tests'); },
    },
  });
  return { manager, logged };
}

test('a plugin outside the declared API range starts anyway, with a warning', async () => {
  let activated = false;
  const { manager, logged } = await managerFor(
    manifestFor({}),
    () => { activated = true; },
  );

  const failures = await manager.start();

  assert.deepEqual(failures, [], 'a range mismatch is not a failure');
  assert.equal(activated, true, 'the plugin ran');
  assert.ok(
    logged.some((line) => line.startsWith('warn') && line.includes('^0.1.0') && line.includes(API_VERSION)),
    `the mismatch is stated once, as a warning: ${logged.join(' | ')}`,
  );
});

test('a plugin that actually throws fails, and the failure says where to report it', async () => {
  const { manager } = await managerFor(
    manifestFor({}),
    () => { throw new Error('window.somethingRemoved is not a function'); },
  );

  const failures = await manager.start();

  assert.equal(failures.length, 1);
  const [failure] = failures;
  assert.ok(failure instanceof PluginStartupError);
  assert.match(failure.message, /^"Old Timer" did not start\./);
  assert.match(failure.message, /\^0\.1\.0/, 'the range is named only now that something broke');
  assert.equal(failure.cause instanceof Error ? failure.cause.message : '', 'window.somethingRemoved is not a function');

  const url = failure.report?.url ?? '';
  assert.ok(url.startsWith('https://github.com/vrcnext-plugins/vrcnext-example-plugin/issues/new?'));
  // A query string spells a space `+`, which decodeURIComponent leaves alone; read it as the
  // form encoding it is, or the assertion tests the encoder rather than the text.
  const prefilled = new URL(url).searchParams;
  assert.match(prefilled.get('body') ?? '', /window\.somethingRemoved is not a function/);
  assert.match(prefilled.get('body') ?? '', /Declared API range/);
  assert.match(prefilled.get('title') ?? '', /^Old Timer 1\.0\.0 does not load on plugin API /);
});

test('a plugin inside the range that throws is reported without blaming the version', async () => {
  const { manager } = await managerFor(
    manifestFor({ apiVersion: `^${API_VERSION}` }),
    () => { throw new Error('boom'); },
  );

  const failures = await manager.start();
  const [failure] = failures;
  assert.ok(failure instanceof PluginStartupError);
  assert.equal(failure.message, '"Old Timer" did not start.');
});

test('a plugin with no GitHub homepage fails without a link the host cannot build', async () => {
  const { manager } = await managerFor(
    manifestFor({ homepage: 'https://example.invalid/plugin' }),
    () => { throw new Error('boom'); },
  );

  const failures = await manager.start();
  const [failure] = failures;
  assert.ok(failure instanceof PluginStartupError);
  assert.equal(failure.report, undefined);
});
