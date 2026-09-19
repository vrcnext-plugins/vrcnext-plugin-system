/**
 * Declarative plugin settings.
 *
 * A plugin describes its settings once as a schema; the host derives both the persisted value
 * type and the rendered settings UI from it. Nothing is stringly-typed — `values.enabled` is a
 * `boolean` and `values.mode` is the literal union of the declared options.
 */

export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

interface SettingBase {
  readonly label: string;
  readonly description?: string;
}

export interface BooleanSetting extends SettingBase {
  readonly kind: 'boolean';
  readonly default: boolean;
}

export interface NumberSetting extends SettingBase {
  readonly kind: 'number';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface StringSetting extends SettingBase {
  readonly kind: 'string';
  readonly default: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
}

export interface SelectSetting<V extends string = string> extends SettingBase {
  readonly kind: 'select';
  readonly default: NoInfer<V>;
  readonly options: readonly SelectOption<V>[];
}

export type SettingSpec =
  | BooleanSetting
  | NumberSetting
  | StringSetting
  | SelectSetting;

export type SettingsSchema = Readonly<Record<string, SettingSpec>>;

/** Maps one spec to the type of its stored value. `select` resolves to its literal option union. */
type InferSetting<S extends SettingSpec> =
  S extends BooleanSetting ? boolean
  : S extends NumberSetting ? number
  : S extends SelectSetting<infer V> ? V
  : S extends StringSetting ? string
  : never;

export type SettingsValues<S extends SettingsSchema> = {
  readonly [K in keyof S]: InferSetting<S[K]>;
};

export interface SettingsStore<S extends SettingsSchema> {
  /** Current values, with defaults filled in for anything never written. */
  readonly values: SettingsValues<S>;

  get<K extends keyof S>(key: K): SettingsValues<S>[K];

  /** Persists one value. Rejects if the store was disposed with the plugin. */
  set<K extends keyof S>(key: K, value: SettingsValues<S>[K]): Promise<void>;

  /** Resets every key to its schema default. */
  reset(): Promise<void>;

  /** Fires after any change, including changes made from the settings UI. */
  onChange(listener: (values: SettingsValues<S>) => void): () => void;
}

/** Builds the default value object for a schema. Exported so the host and tests share one path. */
export function defaultsFor<S extends SettingsSchema>(schema: S): SettingsValues<S> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    out[key] = spec.default;
  }
  return out as SettingsValues<S>;
}

/**
 * Narrows a persisted value to its schema type, returning `undefined` when the stored data no
 * longer matches the schema — a plugin update may have changed a setting's kind or options.
 */
export function coerceSetting(spec: SettingSpec, value: unknown): unknown {
  switch (spec.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      const min = spec.min ?? Number.NEGATIVE_INFINITY;
      const max = spec.max ?? Number.POSITIVE_INFINITY;
      return Math.min(Math.max(value, min), max);
    }
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'select':
      return typeof value === 'string' && spec.options.some((o) => o.value === value)
        ? value
        : undefined;
  }
}
