/**
 * `self()` is the one VRChat member that cannot await its own permission prompt, so it gets its
 * own test: a plugin whose first VRChat call is `self()` must still end up asked.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parsePluginManifest, type Logger, type PluginManifest, type VrchatApi, type VrcSelf } from '@vrcnext/plugin-api';

import { PermissionBroker } from '../permissions/broker.js';
import { GrantStore } from '../permissions/grant-store.js';
import { PluginGate } from '../permissions/plugin-gate.js';
import { MemoryStateService } from '../state/state-service.js';
import { gatedVrchat } from './gated.js';

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
  return { api: gatedVrchat(inner, new PluginGate(manifest(), broker, logger)), asked };
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
