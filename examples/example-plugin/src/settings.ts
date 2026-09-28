/**
 * Every setting kind, once each.
 *
 * The host derives both the persisted value type and the rendered control from this, so there is
 * no form and no parser anywhere in the plugin. Read the rows this produces in
 * Settings → Plugins → Example Plugin next to the code here.
 */

import { defineCustomSetting, type CustomSettingHost, type SettingsSchema, type SettingsValues } from '@vrcnext/plugin-api';

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/** A list item: several kinds nested inside one, including a picker and an embed. */
const rule = {
  name: { kind: 'string', label: 'Rule name', default: 'New rule' },
  when: {
    kind: 'select',
    label: 'When',
    default: 'join',
    options: [
      { value: 'join', label: 'Someone joins' },
      { value: 'leave', label: 'Someone leaves' },
    ],
  },
  who: { kind: 'user', label: 'Only these players', default: [], multiple: true, scopes: ['friends', 'favorites'] },
  loudness: { kind: 'number', label: 'Loudness', default: 2, markers: [0, 1, 2, 3, 4], unit: '!' },
} as const satisfies SettingsSchema;

export const settings = {
  watchGameLog: {
    kind: 'boolean',
    label: 'Follow the VRChat game log',
    description: 'Streams player joins and world changes into the panel below.',
    default: true,
  },
  oscParameter: {
    kind: 'string',
    label: 'OSC parameter to pulse',
    description: 'Sent to /avatar/parameters/<name> by the dashboard button.',
    default: 'VRCEmote',
    placeholder: 'VRCEmote',
  },
  oscValue: {
    kind: 'number',
    label: 'OSC value',
    default: 1,
    min: 0,
    max: 255,
    step: 1,
  },
  volume: {
    kind: 'number',
    label: 'Volume',
    description: 'A slider with labelled markers; it only stops on them.',
    default: 50,
    markers: [0, 25, 50, 75, 100],
    unit: '%',
  },
  verbosity: {
    kind: 'select',
    label: 'Log verbosity',
    default: 'normal',
    options: [
      { value: 'quiet', label: 'Quiet' },
      { value: 'normal', label: 'Normal' },
      { value: 'loud', label: 'Everything' },
    ],
  },
  channels: {
    kind: 'multiselect',
    label: 'Announce on',
    description: 'Several at once. Stored in the order the options are declared.',
    default: ['toast'],
    options: [
      { value: 'toast', label: 'Toast' },
      { value: 'desktop', label: 'Desktop' },
      { value: 'vr', label: 'VR overlay' },
    ],
  },
  accent: {
    kind: 'color',
    label: 'Accent colour',
    default: '#5865f2',
  },
  quietFrom: {
    kind: 'time',
    label: 'Quiet hours start',
    description: 'A time of day, stored as HH:MM.',
    default: '23:00',
  },
  note: {
    kind: 'string',
    multiline: true,
    label: 'Note',
    description: 'A text area on its own line. Commits when it loses focus.',
    default: '',
    placeholder: 'Anything, on several lines',
  },
  token: {
    kind: 'string',
    label: 'API token',
    description: 'Masked in the UI. Settings are stored in plain JSON, so never put a real secret here.',
    default: '',
    format: 'password',
    maxLength: 64,
  },
  watchedFriend: {
    kind: 'user',
    label: 'Watched friend',
    description: 'A picker over your friends, favourites, players seen recently, your instance, or VRChat’s search.',
    default: '',
  },
  homeWorld: {
    kind: 'world',
    label: 'Home world',
    default: '',
    scopes: ['favorites', 'recent', 'current', 'search'],
  },
  showOffAvatar: {
    kind: 'avatar',
    label: 'Show-off avatar',
    default: '',
    scopes: ['own', 'favorites'],
  },
  homeGroup: {
    kind: 'group',
    label: 'Home group',
    default: '',
  },
  announce: {
    kind: 'object',
    label: 'Announcements',
    description: 'A nested object: its fields are stored under this one key.',
    fields: {
      enabled: { kind: 'boolean', label: 'Enabled', default: false },
      prefix: { kind: 'string', label: 'Prefix', default: '[ex] ', disabled: (v) => v['enabled'] !== true },
    },
  },
  webhook: {
    kind: 'embed',
    label: 'Discord embed',
    description: 'Every part of an embed, each text a template. Render it with renderEmbed().',
    default: { title: 'Example Plugin', description: 'Hello {name}', color: 'blue', timestamp: true },
    variables: ['name', 'world', 'time'],
  },
  rules: {
    kind: 'list',
    label: 'Rules',
    description: 'A list of objects. Add, duplicate, reorder, remove; each item’s fields are ordinary settings.',
    titleKey: 'name',
    addLabel: 'Add rule',
    max: 5,
    default: [],
    item: rule,
  },
  /**
   * A kind the plugin renders itself, for a value the built-in kinds cannot express. `coerce`
   * decides what may be stored, exactly as the built-in kinds do for theirs.
   */
  windowSize: defineCustomSetting<WindowSize>({
    kind: 'custom',
    label: 'Window size',
    description: 'A control the plugin draws itself.',
    default: { width: 800, height: 600 },
    coerce: (value) => {
      if (typeof value !== 'object' || value === null) return undefined;
      const record = value as Record<string, unknown>;
      const width = Number(record['width']);
      const height = Number(record['height']);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
      if (width < 320 || height < 240) return undefined;
      return { width, height };
    },
    render: (host) => renderWindowSize(host),
  }),
} as const satisfies SettingsSchema;

export type Settings = typeof settings;
export type Values = SettingsValues<Settings>;

/**
 * The `custom` control: two number fields and a label, wired to `host`. `setValue` rejects when
 * `coerce` refuses the value, which is how the "at least 320×240" rule reaches the user.
 */
function renderWindowSize(host: CustomSettingHost<WindowSize>): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const field = (key: 'width' | 'height'): HTMLInputElement => {
    const input = document.createElement('input');
    input.className = 'vrcn-edit-field';
    input.type = 'number';
    input.style.width = '80px';
    input.value = String(host.value[key]);
    input.addEventListener('change', () => {
      void host.setValue({ ...host.value, [key]: Number(input.value) }).catch(() => {
        host.setError('At least 320 × 240.');
      });
    });
    host.onChange((next) => { input.value = String(next[key]); });
    return input;
  };
  root.append(field('width'), document.createTextNode('×'), field('height'));
  return root;
}
