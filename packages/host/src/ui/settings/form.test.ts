/**
 * The settings form in JSDOM over a memory store: every kind renders a row, nested edits write
 * through to one top-level value, predicates hide and disable rows, and the pickers name ids.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { defaultsFor, type SettingsSchema, type SettingsStore, type SettingsValues, type VrchatApi } from '@vrcnext/plugin-api';

import { storeBinding } from './binding.js';
import { renderForm } from './form.js';

const USER = 'usr_12345678-1234-1234-1234-123456789abc';

const schema = {
  enabled: { kind: 'boolean', label: 'On', default: true },
  level: { kind: 'number', label: 'Level', default: 2, markers: [0, 1, 2, 3], unit: 'x' },
  name: { kind: 'string', label: 'Name', default: 'club', disabled: (v) => v['enabled'] !== true },
  secret: { kind: 'string', label: 'Secret', default: '', format: 'password', hidden: (v) => v['enabled'] !== true },
  at: { kind: 'time', label: 'At', default: '20:00' },
  tint: { kind: 'color', label: 'Tint', default: '#112233' },
  mode: { kind: 'select', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  days: { kind: 'multiselect', label: 'Days', default: ['mon'], options: [{ value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' }] },
  owner: { kind: 'user', label: 'Owner', default: USER },
  embed: { kind: 'embed', label: 'Embed', default: { title: 'Hi' }, variables: ['name'] },
  discord: { kind: 'object', label: 'Discord', fields: { url: { kind: 'string', label: 'URL', default: '' } } },
  presets: {
    kind: 'list',
    label: 'Presets',
    titleKey: 'title',
    default: [{ title: 'One', threshold: 1 }],
    item: { title: { kind: 'string', label: 'Title', default: 'New' }, threshold: { kind: 'number', label: 'Threshold', default: 0 } },
  },
  custom: {
    kind: 'custom',
    label: 'Custom',
    default: 'x',
    coerce: (v: unknown) => (v === 'bad' ? undefined : String(v)),
    render: (host) => {
      const node = document.createElement('button');
      node.id = 'custom';
      node.addEventListener('click', () => { void host.setValue('bad').catch(() => { host.setError('refused'); }); });
      return node;
    },
  },
} as const satisfies SettingsSchema;

type Schema = typeof schema;

/** A store that refuses what `coerce` refuses, like the real one. */
function memoryStore(): SettingsStore<Schema> & { readonly writes: string[] } {
  let values: SettingsValues<Schema> = defaultsFor(schema);
  const listeners = new Set<(v: SettingsValues<Schema>) => void>();
  const writes: string[] = [];
  return {
    writes,
    get values() { return values; },
    get: (key) => values[key],
    set: (key, value) => {
      if (key === 'custom' && schema.custom.coerce(value) === undefined) return Promise.reject(new Error('Value for "custom" does not match its declared kind.'));
      values = { ...values, [key]: value };
      writes.push(key);
      for (const l of listeners) l(values);
      return Promise.resolve();
    },
    reset: () => Promise.resolve(),
    onChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const vrchat = {
  userBasic: () => Promise.resolve({ id: USER, displayName: 'Tupper', imageUrl: '', statusDescription: 'hi' }),
} as unknown as VrchatApi;

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['HTMLElement'] = dom.window.HTMLElement;
});
afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  delete scope['document'];
  delete scope['HTMLElement'];
});

async function settled(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
}

function mount(store: SettingsStore<Schema>): { readonly root: HTMLElement; readonly disposers: (() => void)[] } {
  const disposers: (() => void)[] = [];
  const root = renderForm(schema, storeBinding(store), {
    vrchat,
    values: () => store.values,
    onError: () => undefined,
    track: (d) => { disposers.push(d); },
  });
  dom.window.document.body.appendChild(root);
  return { root, disposers };
}

function row(root: HTMLElement, key: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-setting="${key}"]`);
  assert.ok(node !== null, `row ${key}`);
  return node;
}

test('every kind renders a labelled row; predicates disable and hide', async () => {
  const store = memoryStore();
  const { root } = mount(store);
  for (const key of Object.keys(schema)) assert.ok(root.querySelector(`[data-setting="${key}"]`), key);
  assert.equal(row(root, 'level').querySelectorAll('.vrcnx-slider-mark').length, 4, 'markers are labelled');
  assert.equal(row(root, 'secret').style.display, '');
  assert.equal(row(root, 'name').querySelector('fieldset')?.disabled, false);

  await store.set('enabled', false);
  assert.equal(row(root, 'secret').style.display, 'none');
  assert.equal(row(root, 'name').querySelector('fieldset')?.disabled, true);
});

test('nested edits write through: an object field, a list item field, an embed field', async () => {
  const store = memoryStore();
  const { root } = mount(store);

  const url = row(root, 'discord').querySelector<HTMLInputElement>('[data-setting="url"] input');
  assert.ok(url !== null);
  url.value = 'https://x';
  url.dispatchEvent(new dom.window.Event('change'));
  await settled();
  assert.deepEqual(store.values.discord, { url: 'https://x' });

  const threshold = row(root, 'presets').querySelector<HTMLInputElement>('[data-setting="threshold"] input');
  assert.ok(threshold !== null);
  threshold.value = '7';
  threshold.dispatchEvent(new dom.window.Event('change'));
  await settled();
  assert.deepEqual(store.values.presets, [{ title: 'One', threshold: 7 }]);
  assert.deepEqual(store.writes, ['discord', 'presets'], 'one store write per edit');

  const title = row(root, 'embed').querySelector<HTMLInputElement>('input');
  assert.ok(title !== null);
  title.value = 'Hello {name}';
  title.dispatchEvent(new dom.window.Event('change'));
  await settled();
  assert.equal(store.values.embed.title, 'Hello {name}');
  assert.equal(store.values.embed.fields.length, 0);
});

test('lists add, duplicate and remove items and keep their titles', async () => {
  const store = memoryStore();
  const { root } = mount(store);
  const list = row(root, 'presets');
  const click = (title: string): void => {
    const button = [...list.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === title || b.textContent.includes(title));
    assert.ok(button !== undefined, title);
    button.click();
  };
  click('Add');
  await settled();
  assert.equal(store.values.presets.length, 2);
  assert.equal(store.values.presets[1]?.title, 'New');
  assert.deepEqual([...list.querySelectorAll('.vrcnx-list-title')].map((n) => n.textContent), ['One', 'New']);
  click('Duplicate');
  await settled();
  assert.equal(store.values.presets.length, 3);
  click('Remove');
  await settled();
  assert.equal(store.values.presets.length, 2);
});

test('a refused custom write shows on the row', async () => {
  const store = memoryStore();
  const { root } = mount(store);
  root.querySelector<HTMLButtonElement>('#custom')?.click();
  await settled();
  assert.equal(row(root, 'custom').querySelector('.vrcnx-error')?.textContent, 'refused');
});

test('pickers name the chosen id, and each one carries its own remove', async () => {
  const store = memoryStore();
  const { root } = mount(store);
  await settled();
  const owner = row(root, 'owner');
  assert.match(owner.textContent, /Tupper/);
  // The id is what is stored, not what the user picked: it stays as the row's tooltip only.
  assert.doesNotMatch(owner.textContent, /usr_/);
  assert.equal(owner.querySelector('.vrcnx-picked-row')?.getAttribute('title'), store.values.owner);

  const remove = owner.querySelector<HTMLButtonElement>('.vrcnx-icon-btn');
  remove?.click();
  await settled();
  assert.equal(store.values.owner, '');
  assert.match(owner.textContent, /Nothing chosen/);
});

test('outside writes refresh the controls', async () => {
  const store = memoryStore();
  const { root } = mount(store);
  await store.set('mode', 'b');
  await store.set('at', '07:30');
  await store.set('enabled', false);
  assert.equal(row(root, 'mode').querySelector('select')?.value, 'b');
  assert.equal(row(root, 'at').querySelector('input')?.value, '07:30');
  assert.equal(row(root, 'enabled').querySelector('input')?.checked, false);
});
