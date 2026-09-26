import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isRange, isVersion, satisfies } from './semver.js';

test('accepts plain MAJOR.MINOR.PATCH only', () => {
  assert.ok(isVersion('1.2.3'));
  assert.ok(isVersion('0.0.0'));
  for (const bad of ['1.2', 'v1.2.3', '1.2.3-beta', '01.2.3', '1.2.3+build', '']) {
    assert.ok(!isVersion(bad), bad);
  }
});

test('caret follows npm: the leftmost non-zero digit is the breaking one', () => {
  assert.ok(satisfies('1.9.0', '^1.2.3'));
  assert.ok(!satisfies('2.0.0', '^1.2.3'));
  assert.ok(satisfies('0.2.9', '^0.2.0'));
  assert.ok(!satisfies('0.3.0', '^0.2.0'));
  assert.ok(!satisfies('0.0.4', '^0.0.3'));
});

test('tilde, comparators and exact', () => {
  assert.ok(satisfies('1.2.9', '~1.2.3'));
  assert.ok(!satisfies('1.3.0', '~1.2.3'));
  assert.ok(satisfies('0.3.1', '>=0.2.0 <0.4.0'));
  assert.ok(!satisfies('0.4.0', '>=0.2.0 <0.4.0'));
  assert.ok(satisfies('1.0.0', '1.0.0'));
  assert.ok(satisfies('1.0.0', '=1.0.0'));
});

test('malformed ranges never satisfy and are not ranges', () => {
  for (const bad of ['*', '1.x', '^1', '>=1.0.0 || <0.5.0', '', 'latest']) {
    assert.ok(!isRange(bad), bad);
    assert.ok(!satisfies('1.0.0', bad), bad);
  }
});
