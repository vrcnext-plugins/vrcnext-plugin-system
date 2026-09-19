import assert from 'node:assert/strict';
import { test } from 'vitest';

import { MANIFEST_FORMAT_VERSION, parseRepoManifest } from './manifest.js';

function validPlugin(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'friend-alerts',
    name: 'Friend Alerts',
    version: '1.0.0',
    description: 'Alerts on friend events.',
    entry: 'dist/friend-alerts.js',
    apiVersion: '^0.1.0',
    ...overrides,
  };
}

function validManifest(plugins: readonly unknown[]): Record<string, unknown> {
  return { formatVersion: MANIFEST_FORMAT_VERSION, name: 'Test Repo', plugins };
}

test('parses a well-formed manifest', () => {
  const { manifest, errors } = parseRepoManifest(validManifest([validPlugin()]));
  assert.deepEqual(errors, []);
  assert.ok(manifest);
  assert.equal(manifest.name, 'Test Repo');
  assert.equal(manifest.plugins.length, 1);
  assert.equal(manifest.plugins[0]?.id, 'friend-alerts');
});

test('houses multiple plugins from one repository', () => {
  const { manifest, errors } = parseRepoManifest(
    validManifest([validPlugin(), validPlugin({ id: 'world-notes', name: 'World Notes' })]),
  );
  assert.deepEqual(errors, []);
  assert.ok(manifest);
  assert.equal(manifest.plugins.length, 2);
});

test('rejects a future format version', () => {
  const { manifest, errors } = parseRepoManifest({
    formatVersion: MANIFEST_FORMAT_VERSION + 1,
    name: 'Future',
    plugins: [],
  });
  assert.equal(manifest, undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /newer than supported/);
});

test('skips a malformed entry but keeps the rest', () => {
  const { manifest, errors } = parseRepoManifest(
    validManifest([validPlugin({ id: 'Not Valid Id' }), validPlugin({ id: 'world-notes' })]),
  );
  assert.ok(manifest);
  assert.equal(manifest.plugins.length, 1);
  assert.equal(manifest.plugins[0]?.id, 'world-notes');
  assert.ok(errors.some((e) => e.includes('malformed "id"')));
});

test('drops duplicate ids, keeping the first', () => {
  const { manifest, errors } = parseRepoManifest(
    validManifest([validPlugin({ name: 'First' }), validPlugin({ name: 'Second' })]),
  );
  assert.ok(manifest);
  assert.equal(manifest.plugins.length, 1);
  assert.equal(manifest.plugins[0]?.name, 'First');
  assert.ok(errors.some((e) => e.includes('duplicate id')));
});

test('rejects entry paths that escape the repository root', () => {
  for (const entry of [
    '../other-repo/evil.js',
    '/etc/passwd',
    'https://example.com/evil.js',
    'dist\\windows.js',
    './dist/x.js',
    'dist//x.js',
  ]) {
    const { manifest } = parseRepoManifest(validManifest([validPlugin({ entry })]));
    assert.ok(manifest);
    assert.equal(manifest.plugins.length, 0, `entry should have been rejected: ${entry}`);
  }
});

test('reports a non-object manifest', () => {
  for (const raw of [null, 42, 'text', []]) {
    const { manifest, errors } = parseRepoManifest(raw);
    assert.equal(manifest, undefined);
    assert.ok(errors.length > 0);
  }
});
