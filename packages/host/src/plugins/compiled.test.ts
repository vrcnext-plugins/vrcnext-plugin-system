import assert from 'node:assert/strict';
import { test } from 'vitest';

import { readCompiledTable } from './compiled.js';
import { describeError, toBuildResult, toInstalledList, toProgress } from './plugins-service.js';
import { NativeRequestError } from '../capabilities/native.js';

const manifest = { id: 'a1', name: 'A', version: '1.0.0', apiVersion: '^0.2.0' };
const plugin = { id: 'a1', activate: () => undefined };

test('reads a well-formed table', () => {
  const { plugins, errors } = readCompiledTable([{ manifest, plugin }]);
  assert.deepEqual(errors, []);
  assert.equal(plugins[0]?.manifest.id, 'a1');
});

test('drops entries with a bad manifest, a bad export, a mismatched id or a duplicate, and says why', () => {
  const { plugins, errors } = readCompiledTable([
    { manifest: { ...manifest, id: 'BAD' }, plugin },
    { manifest, plugin: {} },
    { manifest, plugin: { ...plugin, id: 'other' } },
    { manifest, plugin },
    { manifest, plugin },
    null,
  ]);
  assert.equal(plugins.length, 1);
  assert.equal(errors.length, 5);
  assert.match(errors[2] ?? '', /declares id "other"/);
  assert.match(errors[3] ?? '', /listed twice/);
  assert.match(errors[4] ?? '', /entry 5/);
});

test('a non-array table is one error', () => {
  assert.equal(readCompiledTable(undefined).errors.length, 1);
});

test('plugins service shapes are parsed defensively', () => {
  assert.deepEqual(toInstalledList({ plugins: [{ id: 'x1', name: 'X', tags: ['a', 3] }, { nope: 1 }] }).map((p) => [p.id, p.name, p.tags]), [['x1', 'X', ['a']]]);
  assert.deepEqual(toBuildResult({ ok: true, durationMs: 12, plugins: ['x1'], errors: [] }), { ok: true, durationMs: 12, plugins: ['x1'], errors: [] });
  assert.deepEqual(toBuildResult('junk'), { ok: false, durationMs: 0, plugins: [], errors: [] });
  assert.deepEqual(toProgress({ op: 'install', id: 'x1', step: 'clone', message: 'm' }), { op: 'install', id: 'x1', step: 'clone', message: 'm' });
});

test('bridge error codes become sentences', () => {
  const code = (message: string): string => describeError(new NativeRequestError('bad_request', message));
  assert.equal(code('denied by user'), 'Denied on the desktop.');
  assert.match(code('approval_unavailable'), /no way to ask/);
  assert.match(code('policy: main.ts:3 eval('), /source policy: main.ts:3/);
  assert.match(code('manifest_invalid: "id" is missing'), /plugin.json is invalid: "id" is missing/);
  assert.equal(code('already_installed'), 'That plugin is already installed.');
  assert.equal(describeError(new Error('plain')), 'plain');
});
