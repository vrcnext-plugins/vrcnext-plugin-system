/**
 * A value a control edits, wherever it lives.
 *
 * The settings form does not know whether it is editing a top-level setting, a field of an
 * `object`, or a field of the third item of a `list`. Each is a {@link Binding}: read, write,
 * and be told when someone else wrote. Nested bindings write through to their parent, so every
 * edit ends in one `store.set` of the whole top-level value and the plugin sees one change.
 */

import type { SettingsSchema, SettingsStore } from '@vrcnext/plugin-api';

export interface Binding<T = unknown> {
  get(): T;
  /** Rejects when the value is refused (a `custom` coerce said no, or the store was disposed). */
  set(next: T): Promise<void>;
  /** Fires after any write, including writes from other bindings and from the plugin. */
  onChange(listener: (value: T) => void): () => void;
}

export type Values = Readonly<Record<string, unknown>>;

/**
 * A plugin's whole settings store as one object. A write persists only the keys that changed,
 * which is how every nested edit ends in exactly one `store.set`.
 */
export function storeBinding(store: SettingsStore<SettingsSchema>): Binding<Values> {
  return {
    get: () => store.values,
    set: async (next) => {
      const current = store.values;
      for (const [key, value] of Object.entries(next)) {
        if (value !== current[key]) await store.set(key, value);
      }
    },
    onChange: (listener) => store.onChange((values) => { listener(values); }),
  };
}

/** One field of an object-valued binding. */
export function fieldBinding(parent: Binding, key: string): Binding {
  const read = (): Values => {
    const value = parent.get();
    return typeof value === 'object' && value !== null ? (value as Values) : {};
  };
  return {
    get: () => read()[key],
    set: (next) => parent.set({ ...read(), [key]: next }),
    onChange: (listener) => parent.onChange(() => { listener(read()[key]); }),
  };
}

/** One item of an array-valued binding. */
export function itemBinding(parent: Binding, index: number): Binding {
  const read = (): readonly unknown[] => {
    const value = parent.get();
    return Array.isArray(value) ? value : [];
  };
  return {
    get: () => read()[index],
    set: (next) => parent.set(read().with(index, next)),
    onChange: (listener) => parent.onChange(() => { listener(read()[index]); }),
  };
}
