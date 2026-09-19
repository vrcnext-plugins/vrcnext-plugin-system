import assert from 'node:assert/strict';
import { test } from 'vitest';

import { coerceSetting, defaultsFor, type SettingsSchema } from './settings.js';

const schema = {
  enabled: { kind: 'boolean', label: 'Enabled', default: true },
  threshold: { kind: 'number', label: 'Threshold', default: 5, min: 0, max: 10 },
  note: { kind: 'string', label: 'Note', default: '' },
  accentColor: { kind: 'color', label: 'Accent', default: '#ff0055' },
  mode: {
    kind: 'select',
    label: 'Mode',
    default: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'favorites', label: 'Favorites' },
    ],
  },
} as const satisfies SettingsSchema;

test('derives defaults from the schema', () => {
  assert.deepEqual(defaultsFor(schema), {
    enabled: true,
    threshold: 5,
    note: '',
    accentColor: '#ff0055',
    mode: 'all',
  });
});

test('coerces values matching their kind', () => {
  assert.equal(coerceSetting(schema.enabled, false), false);
  assert.equal(coerceSetting(schema.threshold, 7), 7);
  assert.equal(coerceSetting(schema.note, 'hi'), 'hi');
  assert.equal(coerceSetting(schema.accentColor, '#00ffaa'), '#00ffaa');
  assert.equal(coerceSetting(schema.mode, 'favorites'), 'favorites');
});

test('rejects values of the wrong kind', () => {
  assert.equal(coerceSetting(schema.enabled, 'true'), undefined);
  assert.equal(coerceSetting(schema.threshold, 'five'), undefined);
  assert.equal(coerceSetting(schema.threshold, Number.NaN), undefined);
  assert.equal(coerceSetting(schema.note, 42), undefined);
});

test('rejects a select value no longer offered by the schema', () => {
  // A plugin update can remove an option while the old value is still persisted.
  assert.equal(coerceSetting(schema.mode, 'removed-option'), undefined);
});

test('clamps numbers into the declared range', () => {
  assert.equal(coerceSetting(schema.threshold, 99), 10);
  assert.equal(coerceSetting(schema.threshold, -99), 0);
});
