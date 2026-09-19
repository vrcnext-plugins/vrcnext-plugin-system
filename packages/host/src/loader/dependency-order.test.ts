import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { PluginId, PluginKey, RepoId } from '@vrcnext/plugin-api';

import type { InstalledPlugin } from '../registry/registry.js';
import { orderPluginsByDependency } from './dependency-order.js';

function mockPlugin(id: string, deps: readonly string[] = []): InstalledPlugin {
  return {
    key: `test:${id}` as PluginKey,
    repoId: 'test' as RepoId,
    enabled: true,
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

test('returns plugins in order when there are no dependencies', () => {
  const p1 = mockPlugin('p1');
  const p2 = mockPlugin('p2');
  const { ordered, errors } = orderPluginsByDependency([p1, p2]);
  assert.deepEqual(errors, []);
  assert.deepEqual(ordered.map((p) => p.manifest.id), ['p1', 'p2']);
});

test('places dependency before dependent plugin', () => {
  const p1 = mockPlugin('consumer', ['provider']);
  const p2 = mockPlugin('provider');
  const { ordered, errors } = orderPluginsByDependency([p1, p2]);
  assert.deepEqual(errors, []);
  assert.deepEqual(ordered.map((p) => p.manifest.id), ['provider', 'consumer']);
});

test('handles transitive dependency chains (C -> B -> A)', () => {
  const pC = mockPlugin('c', ['b']);
  const pB = mockPlugin('b', ['a']);
  const pA = mockPlugin('a');
  const { ordered, errors } = orderPluginsByDependency([pC, pB, pA]);
  assert.deepEqual(errors, []);
  assert.deepEqual(ordered.map((p) => p.manifest.id), ['a', 'b', 'c']);
});

test('catches missing dependencies and excludes broken plugin from runnable list', () => {
  const p1 = mockPlugin('broken', ['missing-lib']);
  const p2 = mockPlugin('independent');
  const { ordered, errors } = orderPluginsByDependency([p1, p2]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /depends on "missing-lib"/);
  assert.deepEqual(ordered.map((p) => p.manifest.id), ['independent']);
});

test('detects circular dependencies and flags cycle', () => {
  const pA = mockPlugin('a', ['b']);
  const pB = mockPlugin('b', ['a']);
  const pSafe = mockPlugin('safe');
  const { ordered, errors } = orderPluginsByDependency([pA, pB, pSafe]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /Circular dependency detected/);
  assert.deepEqual(ordered.map((p) => p.manifest.id), ['safe']);
});
