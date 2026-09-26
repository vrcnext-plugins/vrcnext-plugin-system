import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parsePluginManifest, type PluginManifest } from '@vrcnext/plugin-api';

import { orderByDependency } from './dependency-order.js';

function plugin(id: string, dependencies: readonly string[] = []): { manifest: PluginManifest } {
  const { manifest } = parsePluginManifest({ id, name: `Plugin ${id}`, version: '1.0.0', apiVersion: '^0.2.0', dependencies });
  assert.ok(manifest);
  return { manifest };
}

const ids = (list: readonly { manifest: PluginManifest }[]): string[] => list.map((p) => p.manifest.id);

test('keeps declaration order when nothing depends on anything', () => {
  const { ordered, errors } = orderByDependency([plugin('p1'), plugin('p2')]);
  assert.deepEqual(errors, []);
  assert.deepEqual(ids(ordered), ['p1', 'p2']);
});

test('places a dependency before its dependent, transitively', () => {
  const { ordered, errors } = orderByDependency([plugin('cc', ['bb']), plugin('bb', ['aa']), plugin('aa')]);
  assert.deepEqual(errors, []);
  assert.deepEqual(ids(ordered), ['aa', 'bb', 'cc']);
});

test('drops a plugin whose dependency is missing, and anything that depends on it', () => {
  const { ordered, errors } = orderByDependency([plugin('broken', ['missing-lib']), plugin('leaf', ['broken']), plugin('ok')]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /depends on "missing-lib"/);
  assert.deepEqual(ids(ordered), ['ok']);
});

test('detects a cycle and keeps the rest', () => {
  const { ordered, errors } = orderByDependency([plugin('aa', ['bb']), plugin('bb', ['aa']), plugin('safe')]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /Circular dependency/);
  assert.deepEqual(ids(ordered), ['safe']);
});
