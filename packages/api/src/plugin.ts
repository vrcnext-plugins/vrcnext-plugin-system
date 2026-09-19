/**
 * The plugin entry contract.
 *
 * A plugin module default-exports one `VrcnextPlugin`. The host calls `activate` once when the
 * plugin is enabled and `deactivate` when it is disabled, updated or uninstalled — anything
 * registered on `ctx.disposables` is torn down automatically in between.
 */

import type { Bridge } from './bridge.js';
import type { DisposableBag } from './disposable.js';
import type { EventBus } from './events.js';
import type { PluginId } from './ids.js';
import type { Logger } from './logger.js';
import type { SettingsSchema, SettingsStore } from './settings.js';
import type { UiApi } from './ui.js';

export interface PluginContext<S extends SettingsSchema = SettingsSchema> {
  readonly id: PluginId;
  readonly version: string;
  readonly logger: Logger;
  readonly settings: SettingsStore<S>;
  readonly events: EventBus;
  readonly bridge: Bridge;
  readonly ui: UiApi;
  /** Register teardown here; the host disposes it on deactivate. */
  readonly disposables: DisposableBag;
  /** Aborts when the plugin is deactivated. Pass to every long-lived `fetch`. */
  readonly signal: AbortSignal;
}

export interface VrcnextPlugin<S extends SettingsSchema = SettingsSchema> {
  /** Must equal the `id` in the repository manifest. */
  readonly id: PluginId;
  /** Settings schema; the host renders and persists it. Omit for a plugin with no settings. */
  readonly settings?: S;
  activate(ctx: PluginContext<S>): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/**
 * Identity helper that pins `S` so `ctx.settings.values` keeps its literal types.
 *
 * Without it, a plugin object declared inline widens its schema to `SettingsSchema` and every
 * value degrades to `boolean | number | string`.
 */
export function definePlugin<const S extends SettingsSchema>(
  plugin: VrcnextPlugin<S>,
): VrcnextPlugin<S> {
  return plugin;
}
