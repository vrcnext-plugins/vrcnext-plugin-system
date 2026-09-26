/**
 * Who has joined a matching instance before.
 *
 * Persisted in a hidden string setting as JSON, because the plugin API offers settings as its
 * only durable store. Capped so it cannot grow without bound; the oldest entries fall off.
 */

import type { SettingsStore } from '@vrcnext/plugin-api';

import type { Settings } from './settings.js';

export interface SeenEntry {
  readonly name: string;
  readonly joins: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly lastLocation: string;
}

const MAX_ENTRIES = 2000;

type SeenMap = Record<string, SeenEntry>;

function parse(raw: string): SeenMap {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: SeenMap = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      out[key] = {
        name: typeof e['name'] === 'string' ? e['name'] : '',
        joins: typeof e['joins'] === 'number' ? e['joins'] : 1,
        firstSeen: typeof e['firstSeen'] === 'number' ? e['firstSeen'] : 0,
        lastSeen: typeof e['lastSeen'] === 'number' ? e['lastSeen'] : 0,
        lastLocation: typeof e['lastLocation'] === 'string' ? e['lastLocation'] : '',
      };
    }
    return out;
  } catch {
    return {};
  }
}

function trimmed(map: SeenMap): SeenMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;
  entries.sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

export class JoinMemory {
  readonly #store: SettingsStore<Settings>;
  #map: SeenMap;

  constructor(store: SettingsStore<Settings>) {
    this.#store = store;
    this.#map = parse(store.get('memory'));
  }

  get size(): number {
    return Object.keys(this.#map).length;
  }

  /** The entry as it was before this join, or `undefined` for a first-timer. */
  previous(key: string): SeenEntry | undefined {
    return this.#map[key];
  }

  /** Records a join and persists. Returns the entry as it was before. */
  async record(key: string, name: string, location: string): Promise<SeenEntry | undefined> {
    const before = this.#map[key];
    const now = Date.now();
    this.#map[key] = {
      name,
      joins: (before?.joins ?? 0) + 1,
      firstSeen: before?.firstSeen ?? now,
      lastSeen: now,
      lastLocation: location,
    };
    this.#map = trimmed(this.#map);
    await this.#store.set('memory', JSON.stringify(this.#map));
    return before;
  }

  async clear(): Promise<void> {
    this.#map = {};
    await this.#store.set('memory', '{}');
  }
}
