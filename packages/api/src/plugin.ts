/**
 * The plugin entry contract.
 *
 * A plugin's `main.ts` default-exports one `VrcnextPlugin`. The host calls `activate` once when
 * the plugin is enabled and `deactivate` when it is disabled or the page unloads — anything
 * registered on `ctx.disposables` is torn down automatically in between.
 *
 * Every capability on the context that can reach outside the plugin's own UI and settings is
 * gated by a permission from `plugin.json`. Calling one without its grant throws a
 * `PermissionError` — it never silently no-ops, so a missing declaration is found on the
 * first run rather than in a user's bug report.
 */

import type { Bridge } from './bridge.js';
import type { ClipboardApi } from './clipboard.js';
import type { ContextMenuApi } from './context-menu.js';
import type { DisposableBag } from './disposable.js';
import type { EventBus } from './events.js';
import type { GameLogApi } from './game-log.js';
import type { HttpApi } from './http.js';
import type { PluginId } from './ids.js';
import type { DeepLinkApi, RouterApi } from './links.js';
import type { Logger } from './logger.js';
import type { NativeApi } from './native.js';
import type { NotificationsApi } from './notifications.js';
import type { OscApi } from './osc.js';
import type { PermissionsApi } from './permissions.js';
import type { SettingsSchema, SettingsStore } from './settings.js';
import type { UiApi } from './ui.js';
import type { VrchatApi } from './vrchat.js';

export interface PluginContext<S extends SettingsSchema = SettingsSchema> {
  readonly id: PluginId;
  readonly version: string;
  readonly logger: Logger;
  readonly settings: SettingsStore<S>;
  /** What this plugin has been granted, and how to ask for more. */
  readonly permissions: PermissionsApi;
  /** Needs `host:events`; event names are checked against the manifest's `events`. */
  readonly events: EventBus;
  /** Needs `host:actions` (`send`, `request`, action names checked) or `host:intercept`. */
  readonly bridge: Bridge;
  readonly ui: UiApi;
  /** Needs `notifications`. */
  readonly notifications: NotificationsApi;
  /** Needs `osc`. */
  readonly osc: OscApi;
  /** Needs `native`. */
  readonly native: NativeApi;
  /** Needs `gamelog`. */
  readonly gameLog: GameLogApi;
  /** Needs `vrchat`. Read-only VRChat data through VRCNext, without its dialogs. */
  readonly vrchat: VrchatApi;
  /** Needs `host:events` with `openDeepLink` in the manifest's `events`. */
  readonly deepLinks: DeepLinkApi;
  /** Needs `routes`. */
  readonly router: RouterApi;
  /** Needs `context-menu`. */
  readonly contextMenu: ContextMenuApi;
  /** Needs `network`; hosts are checked against the manifest's `hosts`. */
  readonly http: HttpApi;
  /** Needs `clipboard`. */
  readonly clipboard: ClipboardApi;
  /** Register teardown here; the host disposes it on deactivate. */
  readonly disposables: DisposableBag;
  /** Aborts when the plugin is deactivated. Pass to every long-lived `fetch`. */
  readonly signal: AbortSignal;
}

export interface VrcnextPlugin<S extends SettingsSchema = SettingsSchema> {
  /** Must equal the `id` in `plugin.json`. */
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
