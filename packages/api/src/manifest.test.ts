import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parsePluginManifest } from './manifest.js';

function valid(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'friend-alerts',
    name: 'Friend alerts',
    version: '1.2.0',
    apiVersion: '^0.2.0',
    description: 'Alerts on friend events.',
    permissions: ['host:events', 'native'],
    optionalPermissions: ['network'],
    actions: [],
    events: ['friendOnline'],
    hosts: ['api.example.com'],
    ...overrides,
  };
}

test('parses a well-formed manifest', () => {
  const { manifest, errors } = parsePluginManifest(valid());
  assert.deepEqual(errors, []);
  assert.ok(manifest);
  assert.equal(manifest.id, 'friend-alerts');
  assert.deepEqual(manifest.permissions, ['host:events', 'native']);
  assert.deepEqual(manifest.optionalPermissions, ['network']);
  assert.deepEqual(manifest.hosts, ['api.example.com']);
  assert.deepEqual(manifest.tags, []);
});

test('defaults the list fields to empty when absent', () => {
  const { manifest } = parsePluginManifest({
    id: 'x1',
    name: 'X',
    version: '0.0.1',
    apiVersion: '^0.2.0',
  });
  assert.ok(manifest);
  assert.deepEqual(manifest.permissions, []);
  assert.deepEqual(manifest.actions, []);
  assert.deepEqual(manifest.events, []);
  assert.deepEqual(manifest.hosts, []);
  assert.equal(manifest.description, '');
});

test('rejects a malformed id', () => {
  for (const id of ['A', 'Friend', 'a', '-x', 'x'.repeat(41), 'a b']) {
    const { manifest, errors } = parsePluginManifest(valid({ id }));
    assert.equal(manifest, undefined, id);
    assert.ok(errors.some((e) => e.includes('"id"')));
  }
});

test('rejects unknown permissions instead of dropping them', () => {
  const { manifest, errors } = parsePluginManifest(valid({ permissions: ['host:events', 'root'] }));
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => e.includes('unknown permission "root"')));
});

test('rejects a non-semver version', () => {
  const { manifest, errors } = parsePluginManifest(valid({ version: 'latest' }));
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => e.includes('MAJOR.MINOR.PATCH')));
});

test('rejects hosts that carry a scheme, path or wildcard', () => {
  for (const host of ['https://api.example.com', 'api.example.com/v1', '*.example.com', '']) {
    const { manifest } = parsePluginManifest(valid({ hosts: [host] }));
    assert.equal(manifest, undefined, host);
  }
  const { manifest } = parsePluginManifest(valid({ hosts: ['localhost:8080', 'API.Example.com'] }));
  assert.ok(manifest);
});

test('enforces the description and tag limits', () => {
  assert.equal(parsePluginManifest(valid({ description: 'x'.repeat(201) })).manifest, undefined);
  const tags = Array.from({ length: 9 }, (_, i) => `t${String(i)}`);
  assert.equal(parsePluginManifest(valid({ tags })).manifest, undefined);
});

test('parses dependencies as plugin ids', () => {
  const { manifest } = parsePluginManifest(valid({ dependencies: ['core-osc'] }));
  assert.deepEqual(manifest?.dependencies, ['core-osc']);
  assert.equal(parsePluginManifest(valid({ dependencies: ['Bad Id'] })).manifest, undefined);
});

test('reports a non-object manifest', () => {
  for (const raw of [null, 42, 'text', []]) {
    const { manifest, errors } = parsePluginManifest(raw);
    assert.equal(manifest, undefined);
    assert.equal(errors.length, 1);
  }
});
