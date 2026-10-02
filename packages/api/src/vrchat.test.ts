import assert from 'node:assert/strict';
import { test } from 'vitest';

import { mostlyStatus, platformLabel, statusLabel } from './vrchat.js';

test('platformLabel reads as VRCNext labels it, passing unknowns through', () => {
  assert.equal(platformLabel('standalonewindows'), 'PC');
  assert.equal(platformLabel('android'), 'Quest');
  assert.equal(platformLabel('ios'), 'iOS');
  assert.equal(platformLabel('web'), 'Web');
  assert.equal(platformLabel('something-new'), 'something-new', 'never guessed at');
  assert.equal(platformLabel(''), '', 'so a caller can drop the row');
});

test('mostlyStatus picks the longest status and never picks unknown', () => {
  assert.equal(mostlyStatus({ 'active': 400, 'join me': 100 }), 'Online');
  assert.equal(mostlyStatus({ 'busy': 50, 'ask me': 900 }), 'Ask Me');
  // `unknown` means VRCNext was not running — a fact about us, not about them.
  assert.equal(mostlyStatus({ unknown: 99_999, active: 5 }), 'Online');
  assert.equal(mostlyStatus({ unknown: 99_999 }), '');
  assert.equal(mostlyStatus({}), '');
  assert.equal(mostlyStatus(undefined), '');
});

test('statusLabel names a status as the app does', () => {
  assert.equal(statusLabel('active'), 'Online');
  assert.equal(statusLabel('busy'), 'Do Not Disturb');
  assert.equal(statusLabel('offline'), 'offline', 'not a status the cards name');
});
