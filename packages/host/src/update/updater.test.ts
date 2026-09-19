import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isNewer } from './updater.js';

test('detects a newer version', () => {
  assert.equal(isNewer('1.0.1', '1.0.0'), true);
  assert.equal(isNewer('1.1.0', '1.0.9'), true);
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
});

test('does not update on equal or older versions', () => {
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.1'), false);
  assert.equal(isNewer('0.9.0', '1.0.0'), false);
});

test('treats prereleases as older than their release', () => {
  assert.equal(isNewer('1.0.0-beta.1', '1.0.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.0-beta.1'), true);
});

test('refuses to update on an unparseable version', () => {
  // A malformed version is an authoring mistake, not a reason to re-download.
  assert.equal(isNewer('not-a-version', '1.0.0'), false);
  assert.equal(isNewer('1.0.0', 'not-a-version'), false);
});
