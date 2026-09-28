import assert from 'node:assert/strict';
import { test } from 'vitest';

import { coerceSetting, defaultOf, defaultsFor, settingFlag, type SettingSpec, type SettingsSchema, type SettingsValues } from './settings.js';
import { EMPTY_EMBED } from './settings-embed.js';

const schema = {
  enabled: { kind: 'boolean', label: 'Enabled', default: true },
  threshold: { kind: 'number', label: 'Threshold', default: 5, min: 0, max: 10 },
  volume: { kind: 'number', label: 'Volume', default: 50, markers: [0, 25, 50, 75, 100] },
  note: { kind: 'string', label: 'Note', default: '', maxLength: 5 },
  accentColor: { kind: 'color', label: 'Accent', default: '#ff0055' },
  quietFrom: { kind: 'time', label: 'Quiet from', default: '22:00' },
  mode: {
    kind: 'select',
    label: 'Mode',
    default: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'favorites', label: 'Favorites' },
    ],
  },
  days: {
    kind: 'multiselect',
    label: 'Days',
    default: ['mon'],
    max: 2,
    options: [
      { value: 'mon', label: 'Monday' },
      { value: 'tue', label: 'Tuesday' },
      { value: 'wed', label: 'Wednesday' },
    ],
  },
  owner: { kind: 'user', label: 'Owner', default: '' },
  staff: { kind: 'user', label: 'Staff', default: [], multiple: true, scopes: ['friends'] },
  home: { kind: 'world', label: 'Home', default: '' },
  embed: { kind: 'embed', label: 'Embed', default: { title: 'Hi {name}' } },
  discord: {
    kind: 'object',
    label: 'Discord',
    fields: {
      enabled: { kind: 'boolean', label: 'On', default: false },
      url: { kind: 'string', label: 'URL', default: '' },
    },
  },
  presets: {
    kind: 'list',
    label: 'Presets',
    titleKey: 'name',
    default: [{ name: 'Default', level: 1 }],
    item: {
      name: { kind: 'string', label: 'Name', default: 'New' },
      level: { kind: 'number', label: 'Level', default: 0, min: 0, max: 3 },
    },
  },
  shape: {
    kind: 'custom',
    label: 'Shape',
    default: { w: 1, h: 1 },
    coerce: (value: unknown): { w: number; h: number } | undefined =>
      typeof value === 'object' && value !== null && 'w' in value && 'h' in value
        ? { w: Number((value as { w: unknown }).w), h: Number((value as { h: unknown }).h) }
        : undefined,
    render: () => document.createElement('div'),
  },
} as const satisfies SettingsSchema;

type Values = SettingsValues<typeof schema>;

test('the value types follow the schema', () => {
  const values: Values = defaultsFor(schema);
  const mode: 'all' | 'favorites' = values.mode;
  const days: readonly ('mon' | 'tue' | 'wed')[] = values.days;
  const owner: string = values.owner;
  const staff: readonly string[] = values.staff;
  const level: number = values.presets[0]?.level ?? 0;
  const url: string = values.discord.url;
  const shape: { w: number; h: number } = values.shape;
  assert.deepEqual([mode, days, owner, staff, level, url, shape.w], ['all', ['mon'], '', [], 1, '', 1]);
});

test('derives defaults from the schema, completing objects and embeds', () => {
  const values = defaultsFor(schema);
  assert.equal(values.enabled, true);
  assert.equal(values.quietFrom, '22:00');
  assert.deepEqual(values.discord, { enabled: false, url: '' });
  assert.deepEqual(values.embed, { ...EMPTY_EMBED, title: 'Hi {name}' });
  assert.deepEqual(values.presets, [{ name: 'Default', level: 1 }]);
});

test('coerces values matching their kind', () => {
  assert.equal(coerceSetting(schema.enabled, false), false);
  assert.equal(coerceSetting(schema.threshold, 7), 7);
  assert.equal(coerceSetting(schema.note, 'hi'), 'hi');
  assert.equal(coerceSetting(schema.accentColor, '#00ffaa'), '#00ffaa');
  assert.equal(coerceSetting(schema.quietFrom, '07:30'), '07:30');
  assert.equal(coerceSetting(schema.mode, 'favorites'), 'favorites');
  assert.deepEqual(coerceSetting(schema.days, ['wed', 'mon']), ['mon', 'wed'], 'multiselect keeps option order');
  assert.equal(coerceSetting(schema.owner, 'usr_12345678-1234-1234-1234-123456789abc'), 'usr_12345678-1234-1234-1234-123456789abc');
  assert.deepEqual(coerceSetting(schema.shape, { w: '2', h: 3 }), { w: 2, h: 3 });
});

test('rejects values of the wrong kind', () => {
  assert.equal(coerceSetting(schema.enabled, 'true'), undefined);
  assert.equal(coerceSetting(schema.threshold, 'five'), undefined);
  assert.equal(coerceSetting(schema.threshold, Number.NaN), undefined);
  assert.equal(coerceSetting(schema.note, 42), undefined);
  assert.equal(coerceSetting(schema.quietFrom, '25:00'), undefined);
  assert.equal(coerceSetting(schema.days, 'mon'), undefined);
  assert.equal(coerceSetting(schema.owner, 'not an id'), undefined);
  assert.equal(coerceSetting(schema.shape, 'nope'), undefined);
});

test('rejects a select value no longer offered by the schema', () => {
  // A plugin update can remove an option while the old value is still persisted.
  assert.equal(coerceSetting(schema.mode, 'removed-option'), undefined);
  assert.deepEqual(coerceSetting(schema.days, ['removed', 'tue']), ['tue']);
});

test('clamps numbers into the declared range and snaps to markers', () => {
  assert.equal(coerceSetting(schema.threshold, 99), 10);
  assert.equal(coerceSetting(schema.threshold, -99), 0);
  assert.equal(coerceSetting(schema.volume, 60), 50);
  assert.equal(coerceSetting(schema.volume, 999), 100);
  assert.equal(coerceSetting({ ...schema.volume, stickToMarkers: false }, 60), 60);
});

test('cuts strings to maxLength and multiselects to max', () => {
  assert.equal(coerceSetting(schema.note, 'toolong!'), 'toolo');
  assert.deepEqual(coerceSetting(schema.days, ['mon', 'tue', 'wed']), ['mon', 'tue']);
});

test('multiple pickers store distinct valid ids only', () => {
  const id = 'usr_12345678-1234-1234-1234-123456789abc';
  assert.deepEqual(coerceSetting(schema.staff, [id, ' ' + id, 'junk', 7]), [id]);
  assert.deepEqual(coerceSetting(schema.staff, ''), []);
  assert.equal(coerceSetting(schema.staff, id), undefined, 'a single id is not a list');
  assert.equal(coerceSetting(schema.home, 'wrld_12345678-1234-1234-1234-123456789abc'), 'wrld_12345678-1234-1234-1234-123456789abc');
  assert.equal(coerceSetting(schema.home, 'usr_12345678-1234-1234-1234-123456789abc'), undefined);
});

test('objects and lists are repaired field by field rather than dropped', () => {
  assert.deepEqual(coerceSetting(schema.discord, { enabled: true, url: 5, extra: 1 }), { enabled: true, url: '' });
  assert.deepEqual(
    coerceSetting(schema.presets, [{ name: 'A', level: 9 }, 'junk', { level: 2 }]),
    [{ name: 'A', level: 3 }, { name: 'New', level: 2 }],
  );
  assert.equal(coerceSetting(schema.presets, { name: 'A' }), undefined);
});

test('embeds keep the fields they recognise', () => {
  const embed = coerceSetting(schema.embed, { title: 'T', color: 'green', timestamp: true, fields: [{ name: 'n', value: 'v' }, 'x'], junk: 1 });
  assert.deepEqual(embed, { ...EMPTY_EMBED, title: 'T', color: 'green', timestamp: true, fields: [{ name: 'n', value: 'v', inline: false }] });
});

test('settingFlag evaluates booleans and predicates', () => {
  assert.equal(settingFlag(undefined, {}), false);
  assert.equal(settingFlag(true, {}), true);
  assert.equal(settingFlag((v) => v['enabled'] === true, { enabled: true }), true);
});

test('a switched group keeps its switch through a repair, and defaults it when there is none', () => {
  const spec = {
    kind: 'object',
    label: 'Discord',
    toggle: { label: 'Post to a webhook', default: false },
    fields: { webhookUrl: { kind: 'string', label: 'URL', default: '' } },
  } as const satisfies SettingSpec;

  // The bug this exists for: an object whose switch was stored, repaired, and came back without
  // it — a group the UI drew as on that every reader saw as off.
  assert.deepEqual(
    coerceSetting(spec, { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/a' }),
    { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/a' },
  );
  assert.deepEqual(coerceSetting(spec, { enabled: false, webhookUrl: '' }), { enabled: false, webhookUrl: '' });
  assert.deepEqual(coerceSetting(spec, { webhookUrl: '' }), { enabled: false, webhookUrl: '' }, 'absent means the declared default');
  assert.deepEqual(coerceSetting(spec, { enabled: 'yes', webhookUrl: '' }), { enabled: false, webhookUrl: '' }, 'and so does nonsense');
  assert.deepEqual(defaultOf(spec), { enabled: false, webhookUrl: '' });
});

test('an object with no switch gains no switch', () => {
  const spec = { kind: 'object', label: 'Plain', fields: { a: { kind: 'string', label: 'A', default: '' } } } as const satisfies SettingSpec;
  assert.deepEqual(coerceSetting(spec, { a: 'x', enabled: true }), { a: 'x' });
});
