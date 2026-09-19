import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { PluginId, PluginKey, RepoId } from '@vrcnext/plugin-api';

import { PluginManager } from './plugin-manager.js';
import type { PluginLoader } from './loader/plugin-loader.js';
import type { InstalledPlugin, InstalledRepo, Registry } from './registry/registry.js';

function createMockPlugin(id: string, enabled = false, deps: readonly string[] = []): InstalledPlugin {
  return {
    key: `repo:${id}` as PluginKey,
    repoId: 'repo' as RepoId,
    enabled,
    installedAt: 1000,
    source: '',
    manifest: {
      id: id as PluginId,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: '',
      entry: 'index.js',
      apiVersion: '^0.1.0',
      dependencies: deps as readonly PluginId[],
    },
  };
}

class MockRegistry {
  plugins: InstalledPlugin[] = [];
  repos: InstalledRepo[] = [];

  get enabledPlugins(): InstalledPlugin[] {
    return this.plugins.filter((p) => p.enabled);
  }

  find(key: PluginKey): InstalledPlugin | undefined {
    return this.plugins.find((p) => p.key === key);
  }

  setEnabled(key: PluginKey, enabled: boolean): Promise<InstalledPlugin> {
    const existing = this.plugins.find((p) => p.key === key);
    if (existing === undefined) return Promise.reject(new Error('Not found'));
    const updated = { ...existing, enabled };
    const idx = this.plugins.indexOf(existing);
    this.plugins[idx] = updated;
    return Promise.resolve(updated);
  }
}

class MockLoader {
  active = new Set<PluginKey>();
  activatedOrder: PluginId[] = [];

  isActive(key: PluginKey): boolean {
    return this.active.has(key);
  }

  activate(record: InstalledPlugin): Promise<void> {
    this.active.add(record.key);
    this.activatedOrder.push(record.manifest.id);
    return Promise.resolve();
  }

  deactivate(key: PluginKey): Promise<void> {
    this.active.delete(key);
    return Promise.resolve();
  }

  deactivateAll(): Promise<void> {
    this.active.clear();
    return Promise.resolve();
  }
}

test('activates enabled plugins in dependency order on boot', async () => {
  const registry = new MockRegistry();
  const loader = new MockLoader();
  const pA = createMockPlugin('lib-a', true);
  const pB = createMockPlugin('plugin-b', true, ['lib-a']);

  // Insert in reverse order
  registry.plugins = [pB, pA];

  const manager = new PluginManager(registry as unknown as Registry, loader as unknown as PluginLoader);
  const failures = await manager.activateEnabled();

  assert.deepEqual(failures, []);
  assert.deepEqual(loader.activatedOrder, ['lib-a', 'plugin-b']);
});

test('auto-enables dependencies recursively when enabling a plugin', async () => {
  const registry = new MockRegistry();
  const loader = new MockLoader();
  const pA = createMockPlugin('lib-a', false);
  const pB = createMockPlugin('plugin-b', false, ['lib-a']);

  registry.plugins = [pA, pB];

  const manager = new PluginManager(registry as unknown as Registry, loader as unknown as PluginLoader);
  await manager.setEnabled(pB.key, true);

  assert.equal(registry.find(pA.key)?.enabled, true);
  assert.equal(registry.find(pB.key)?.enabled, true);
  assert.deepEqual(loader.activatedOrder, ['lib-a', 'plugin-b']);
});

test('fails cleanly when enabling a plugin with a missing dependency', async () => {
  const registry = new MockRegistry();
  const loader = new MockLoader();
  const pB = createMockPlugin('plugin-b', false, ['missing-lib']);

  registry.plugins = [pB];

  const manager = new PluginManager(registry as unknown as Registry, loader as unknown as PluginLoader);
  await assert.rejects(
    async () => { await manager.setEnabled(pB.key, true); },
    /dependency "missing-lib" is not installed/,
  );

  assert.equal(registry.find(pB.key)?.enabled, false);
});
