/**
 * Declarative plugin settings.
 *
 * A plugin describes its settings once as a schema; the host derives both the persisted value
 * type and the rendered settings UI from it. Nothing is stringly-typed — `values.enabled` is a
 * `boolean`, `values.mode` is the literal union of the declared options, and `values.presets`
 * is an array of objects shaped like the `list` item schema.
 *
 * Kinds, and what each one stores and renders:
 *
 * | kind | value | control |
 * | :-- | :-- | :-- |
 * | `boolean` | `boolean` | switch |
 * | `number` | `number` | text field, or a slider (with optional markers) |
 * | `string` | `string` | text field or text area |
 * | `color` | `#rrggbb` | colour picker |
 * | `time` | `HH:MM` | time picker |
 * | `select` | one option value | dropdown |
 * | `multiselect` | option values | checklist |
 * | `user` `world` `avatar` `group` `instance` | VRChat id(s) | picker over VRCNext's data ({@link EntitySetting}) |
 * | `embed` | a Discord embed template | embed editor ({@link EmbedSetting}) |
 * | `object` | an object shaped like `fields` | nested rows |
 * | `list` | an array of objects shaped like `item` | add / remove / reorder cards |
 * | `custom` | whatever the plugin says | the plugin's own control ({@link CustomSetting}) |
 *
 * `object` and `list` nest: a list item may itself contain a list, a picker or an embed.
 */

import { coerceEmbed, completeEmbed, type EmbedSetting, type EmbedTemplate } from './settings-embed.js';
import { coerceEntity, type EntitySetting } from './settings-entity.js';

export type { EmbedSetting, EmbedTemplate } from './settings-embed.js';
export type {
  AvatarScope,
  AvatarSetting,
  EntityKind,
  EntitySetting,
  GroupScope,
  GroupSetting,
  InstanceScope,
  InstanceSetting,
  UserScope,
  UserSetting,
  WorldScope,
  WorldSetting,
} from './settings-entity.js';

export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** Muted second line under the label, where the control has room for one. */
  readonly description?: string;
}

/** A yes/no that may depend on the plugin's other settings; re-evaluated after every change. */
export type SettingPredicate = boolean | ((values: Readonly<Record<string, unknown>>) => boolean);

/**
 * The placeholders a setting's text may use: the name, and what it holds.
 *
 * The description is not decoration. It is the only place a user finds out what `rejoinAgo`
 * means without reading the plugin's README, so the host shows it on hover and lets the name be
 * copied in its `{...}` form. A setting that declares these also gets its text checked against
 * them, so a typo is visible while it is being typed rather than in the output an hour later.
 */
export type SettingVariables = Readonly<Record<string, string>>;

export interface SettingBase {
  readonly label: string;
  readonly description?: string;
  /** Not rendered. Still stored and readable, for values a plugin manages itself. */
  readonly hidden?: SettingPredicate;
  /** Rendered, but not editable. */
  readonly disabled?: SettingPredicate;
  /**
   * Placeholders this setting's text may contain, as `name` to a one-line description.
   *
   * Declaring them turns on the variables card under the control and the check that every
   * `{name}` written there is one of these.
   */
  readonly variables?: SettingVariables;
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
  /** Renders a slider instead of a text field. Implied by `markers`. */
  readonly slider?: boolean;
  /**
   * Tick marks along the slider, each labelled. With `stickToMarkers` (the default when markers
   * are given) the slider only stops on them; the first and last marker bound the range.
   */
  readonly markers?: readonly number[];
  readonly stickToMarkers?: boolean;
  /** Whole numbers only: the control steps by one and a stored value is rounded. */
  readonly integer?: boolean;
  /** Shown after the value, e.g. `s`, `%`, `px`. */
  readonly unit?: string;
}

export interface StringSetting extends SettingBase {
  readonly kind: 'string';
  readonly default: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  /** Longer input is cut, both in the UI and on `set`. */
  readonly maxLength?: number;
  /** `password` masks the field; `url` narrows what the field accepts. */
  readonly format?: 'text' | 'password' | 'url';
}

export interface ColorSetting extends SettingBase {
  readonly kind: 'color';
  /** `#rgb`, `#rrggbb` or `#rrggbbaa`. */
  readonly default: string;
}

/** A time of day, stored as `HH:MM` in 24-hour form. */
export interface TimeSetting extends SettingBase {
  readonly kind: 'time';
  readonly default: string;
}

export interface SelectSetting<V extends string = string> extends SettingBase {
  readonly kind: 'select';
  readonly default: NoInfer<V>;
  readonly options: readonly SelectOption<V>[];
}

/** Several of the options at once. Stored in the order the options are declared. */
export interface MultiSelectSetting<V extends string = string> extends SettingBase {
  readonly kind: 'multiselect';
  readonly default: readonly NoInfer<V>[];
  readonly options: readonly SelectOption<V>[];
  /** Fewest and most that may be chosen. */
  readonly min?: number;
  readonly max?: number;
}

/**
 * A switch on an object's header that gates everything inside it.
 *
 * The state lives under `enabled` beside the object's own fields, so a plugin reads
 * `values.report.enabled` and the fields it guards in one place rather than keeping a loose
 * boolean next to them and hoping the two stay in step.
 */
export interface ObjectToggle {
  /** What the switch says, e.g. `Use a custom report template`. */
  readonly label: string;
  readonly default: boolean;
  readonly description?: string;
}

/** A nested object: its `fields` render indented under the label. */
export interface ObjectSetting<F extends SettingsSchema = SettingsSchema> extends SettingBase {
  readonly kind: 'object';
  readonly fields: F;
  /** Starts folded. */
  readonly collapsed?: boolean;
  /** Turns the object into a switched group: its fields show only while the switch is on. */
  readonly toggle?: ObjectToggle;
}

/** Where an {@link ObjectToggle} keeps its state inside the object's value. */
export const TOGGLE_KEY = 'enabled';

/**
 * A list of objects, each shaped like `item`. Rendered as cards the user can add, remove,
 * duplicate and reorder; every item's fields use the same controls as top-level settings, so a
 * list item can hold pickers, embeds and further lists.
 */
export interface ListSetting<I extends SettingsSchema = SettingsSchema> extends SettingBase {
  readonly kind: 'list';
  readonly item: I;
  readonly default: readonly SettingsValues<I>[];
  /** Which item field names the card; falls back to `Item n`. */
  readonly titleKey?: keyof I & string;
  /** What the add button says. Default `Add`. */
  readonly addLabel?: string;
  readonly max?: number;
}

/** What a {@link CustomSetting} control gets to work with. */
export interface CustomSettingHost<T> {
  /** The current value, updated after every commit including ones from `ctx.settings.set`. */
  readonly value: T;
  /** Persist a new value. Rejects when the plugin's `coerce` refuses it. */
  setValue(next: T): Promise<void>;
  /** Show or clear an error line under the control. */
  setError(message: string | undefined): void;
  /** Called with every value change, so the control can redraw. Returns the unsubscribe. */
  onChange(listener: (value: T) => void): () => void;
}

/**
 * A control the plugin renders itself, for a value the built-in kinds cannot express.
 *
 * The value must be plain JSON. `coerce` decides what a stored or written value is allowed to
 * be, exactly like the built-in kinds do for theirs: return the cleaned value, or `undefined`
 * to fall back to `default`.
 */
export interface CustomSetting<T = unknown> extends SettingBase {
  readonly kind: 'custom';
  readonly default: T;
  coerce(value: unknown): T | undefined;
  /** Builds the control. Runs once per settings card; use `host.onChange` to follow later writes. */
  render(host: CustomSettingHost<T>): HTMLElement;
}

/**
 * Identity helper that pins a {@link CustomSetting}'s value type.
 *
 * Without it the schema literal is contextually typed by `SettingSpec`, where the custom kind is
 * `CustomSetting<unknown>`: `render` would receive an `unknown` value and `values.thing` would be
 * `unknown` too.
 *
 * ```ts
 * windowSize: defineCustomSetting<WindowSize>({
 *   kind: 'custom', label: 'Window size', default: { width: 800, height: 600 },
 *   coerce: (value) => (isWindowSize(value) ? value : undefined),
 *   render: (host) => renderWindowSize(host),
 * }),
 * ```
 */
export function defineCustomSetting<T>(spec: CustomSetting<T>): CustomSetting<T> {
  return spec;
}

export type SettingSpec =
  | BooleanSetting
  | ColorSetting
  | CustomSetting
  | EmbedSetting
  | EntitySetting
  | ListSetting
  | MultiSelectSetting
  | NumberSetting
  | ObjectSetting
  | SelectSetting
  | StringSetting
  | TimeSetting;

export type SettingsSchema = Readonly<Record<string, SettingSpec>>;

/** Maps one spec to the type of its stored value. `select` resolves to its literal option union. */
export type InferSetting<S extends SettingSpec> =
  S extends BooleanSetting ? boolean
  : S extends ColorSetting ? string
  : S extends TimeSetting ? string
  : S extends NumberSetting ? number
  : S extends SelectSetting<infer V> ? V
  : S extends MultiSelectSetting<infer V> ? readonly V[]
  : S extends StringSetting ? string
  : S extends EmbedSetting ? EmbedTemplate
  : S extends EntitySetting ? (S extends { readonly multiple: true } ? readonly string[] : string)
  : S extends ObjectSetting<infer F>
    ? (S extends { readonly toggle: ObjectToggle }
        ? SettingsValues<F> & { readonly [TOGGLE_KEY]: boolean }
        : SettingsValues<F>)
  : S extends ListSetting<infer I> ? readonly SettingsValues<I>[]
  : S extends CustomSetting<infer T> ? T
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

/** Evaluates a `hidden` or `disabled` flag against the current values. */
export function settingFlag(flag: SettingPredicate | undefined, values: Readonly<Record<string, unknown>>): boolean {
  if (typeof flag === 'function') return flag(values);
  return flag === true;
}

/** The default of one spec: structured kinds are completed field by field. */
export function defaultOf(spec: SettingSpec): unknown {
  if (spec.kind === 'object') {
    const fields = defaultsFor(spec.fields);
    return spec.toggle === undefined ? fields : { ...fields, [TOGGLE_KEY]: spec.toggle.default };
  }
  if (spec.kind === 'embed') return completeEmbed(spec.default);
  return spec.default;
}

/** Builds the default value object for a schema. Exported so the host and tests share one path. */
export function defaultsFor<S extends SettingsSchema>(schema: S): SettingsValues<S> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    out[key] = defaultOf(spec);
  }
  return out as SettingsValues<S>;
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function coerceNumber(spec: NumberSetting, value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const markers = spec.markers ?? [];
  const min = spec.min ?? (markers.length > 0 ? Math.min(...markers) : Number.NEGATIVE_INFINITY);
  const max = spec.max ?? (markers.length > 0 ? Math.max(...markers) : Number.POSITIVE_INFINITY);
  const clamped = Math.min(Math.max(value, min), max);
  if (markers.length > 0 && spec.stickToMarkers !== false) {
    return markers.reduce((best, m) => (Math.abs(m - clamped) < Math.abs(best - clamped) ? m : best));
  }
  return spec.integer === true ? Math.round(clamped) : clamped;
}

function coerceMultiSelect(spec: MultiSelectSetting, value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const chosen = new Set(value.filter((v): v is string => typeof v === 'string'));
  const ordered = spec.options.map((o) => o.value).filter((v) => chosen.has(v));
  if (spec.max !== undefined && ordered.length > spec.max) return ordered.slice(0, spec.max);
  return ordered;
}

function coerceObject(fields: SettingsSchema, value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const coerced = Object.hasOwn(record, key) ? coerceSetting(spec, record[key]) : undefined;
    out[key] = coerced ?? defaultOf(spec);
  }
  return out;
}

function coerceList(spec: ListSetting, value: unknown): readonly Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((entry) => {
    const item = coerceObject(spec.item, entry);
    return item === undefined ? [] : [item];
  });
  return spec.max === undefined ? items : items.slice(0, spec.max);
}

/**
 * Narrows a persisted value to its schema type, returning `undefined` when the stored data no
 * longer matches the schema — a plugin update may have changed a setting's kind or options.
 * Structured kinds (`object`, `list`) are repaired field by field rather than dropped whole.
 */
export function coerceSetting(spec: SettingSpec, value: unknown): unknown {
  switch (spec.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'number':
      return coerceNumber(spec, value);
    case 'string': {
      if (typeof value !== 'string') return undefined;
      return spec.maxLength === undefined ? value : value.slice(0, spec.maxLength);
    }
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : undefined;
    case 'time':
      return typeof value === 'string' && TIME.test(value) ? value : undefined;
    case 'select':
      return typeof value === 'string' && spec.options.some((o) => o.value === value) ? value : undefined;
    case 'multiselect':
      return coerceMultiSelect(spec, value);
    case 'user':
    case 'world':
    case 'avatar':
    case 'group':
    case 'instance':
      return coerceEntity(spec, value);
    case 'embed':
      return coerceEmbed(value);
    case 'object':
      return coerceObject(spec.fields, value);
    case 'list':
      return coerceList(spec, value);
    case 'custom':
      return spec.coerce(value);
  }
}
