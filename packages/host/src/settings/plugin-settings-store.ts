/**
 * Persisted, schema-validated plugin settings.
 *
 * Values are loaded once at activation so `values` can be a synchronous property — a plugin
 * reading a setting inside an event handler should not have to await the bridge. Each key is its
 * own entry in the plugin's state namespace, so the manager can show or clear them individually.
 */

import {
  coerceSetting,
  defaultsFor,
  type SettingsSchema,
  type SettingsStore,
  type SettingsValues,
} from '@vrcnext/plugin-api';

import { DebouncedWriter } from '../state/debounced-writer.js';
import type { StateService } from '../state/state-service.js';

type ChangeListener<S extends SettingsSchema> = (values: SettingsValues<S>) => void;

export class PluginSettingsStore<S extends SettingsSchema> implements SettingsStore<S> {
  readonly #schema: S;
  readonly #writer: DebouncedWriter;
  readonly #listeners = new Set<ChangeListener<S>>();
  #values: SettingsValues<S>;

  private constructor(schema: S, writer: DebouncedWriter, values: SettingsValues<S>) {
    this.#schema = schema;
    this.#writer = writer;
    this.#values = values;
  }

  /** Loads persisted values, discarding anything that no longer matches the schema. */
  static async load<S extends SettingsSchema>(
    schema: S,
    ns: string,
    service: StateService,
    onError: (error: unknown) => void,
  ): Promise<PluginSettingsStore<S>> {
    const persisted = await service.list(ns);
    const values = PluginSettingsStore.#merge(schema, persisted);
    return new PluginSettingsStore(schema, new DebouncedWriter(service, ns, onError), values);
  }

  static #merge<S extends SettingsSchema>(
    schema: S,
    persisted: Readonly<Record<string, unknown>>,
  ): SettingsValues<S> {
    const merged: Record<string, unknown> = { ...defaultsFor(schema) };
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
    this.#emit();
    await this.#writer.set(String(key), coerced);
  }

  async reset(): Promise<void> {
    this.#values = defaultsFor(this.#schema);
    this.#emit();
    await Promise.all(
      Object.entries(this.#values).map(([key, value]) => this.#writer.set(key, value)),
    );
  }

  /** Push anything still debounced. Called on deactivate so a last change is not lost. */
  flush(): Promise<void> {
    return this.#writer.flush();
  }

  #emit(): void {
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
