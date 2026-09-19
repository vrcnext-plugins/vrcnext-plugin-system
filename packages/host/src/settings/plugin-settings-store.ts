/**
 * Persisted, schema-validated plugin settings.
 *
 * Values are loaded once at activation so `values` can be a synchronous property — a plugin
 * reading a setting inside an event handler should not have to await IndexedDB.
 */

import {
  coerceSetting,
  defaultsFor,
  type SettingsSchema,
  type SettingsStore,
  type SettingsValues,
} from '@vrcnext/plugin-api';

import { STORES, type IdbStore } from '../storage/idb-store.js';

type ChangeListener<S extends SettingsSchema> = (values: SettingsValues<S>) => void;

export class PluginSettingsStore<S extends SettingsSchema> implements SettingsStore<S> {
  readonly #schema: S;
  readonly #storageKey: string;
  readonly #storage: IdbStore;
  readonly #listeners = new Set<ChangeListener<S>>();
  #values: SettingsValues<S>;

  private constructor(schema: S, storageKey: string, storage: IdbStore, values: SettingsValues<S>) {
    this.#schema = schema;
    this.#storageKey = storageKey;
    this.#storage = storage;
    this.#values = values;
  }

  /** Loads persisted values, discarding anything that no longer matches the schema. */
  static async load<S extends SettingsSchema>(
    schema: S,
    storageKey: string,
    storage: IdbStore,
  ): Promise<PluginSettingsStore<S>> {
    const persisted = await storage.get<Record<string, unknown>>(STORES.settings, storageKey);
    const values = PluginSettingsStore.#merge(schema, persisted);
    return new PluginSettingsStore(schema, storageKey, storage, values);
  }

  static #merge<S extends SettingsSchema>(
    schema: S,
    persisted: Record<string, unknown> | undefined,
  ): SettingsValues<S> {
    const merged: Record<string, unknown> = { ...defaultsFor(schema) };
    if (persisted === undefined) return merged as SettingsValues<S>;

    for (const [key, spec] of Object.entries(schema)) {
      if (!Object.hasOwn(persisted, key)) continue;
      const coerced = coerceSetting(spec, persisted[key]);
      if (coerced !== undefined) merged[key] = coerced;
    }
    return merged as SettingsValues<S>;
  }

  get values(): SettingsValues<S> {
    return this.#values;
  }

  get<K extends keyof S>(key: K): SettingsValues<S>[K] {
    return this.#values[key];
  }

  async set<K extends keyof S>(key: K, value: SettingsValues<S>[K]): Promise<void> {
    const spec = this.#schema[key];
    if (spec === undefined) {
      throw new Error(`"${String(key)}" is not declared in this plugin's settings schema.`);
    }
    const coerced = coerceSetting(spec, value);
    if (coerced === undefined) {
      throw new Error(`Value for "${String(key)}" does not match its declared kind.`);
    }

    this.#values = { ...this.#values, [key]: coerced };
    await this.#persist();
  }

  async reset(): Promise<void> {
    this.#values = defaultsFor(this.#schema);
    await this.#persist();
  }

  async #persist(): Promise<void> {
    await this.#storage.set(STORES.settings, this.#storageKey, this.#values);
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#values);
      } catch (error) {
        globalThis.console.error('[vrcnext-plugins] settings listener threw', error);
      }
    }
  }

  onChange(listener: ChangeListener<S>): () => void {
    this.#listeners.add(listener);
    return (): void => { this.#listeners.delete(listener); };
  }
}
