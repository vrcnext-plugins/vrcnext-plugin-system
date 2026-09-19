/**
 * `@vrcnext/plugin-api` — the contract between a VRCNext plugin and the plugin host.
 *
 * This package is types plus a little pure logic (manifest parsing, settings defaults). It has
 * no DOM side effects and no host dependency, so plugin authors can unit-test against it and
 * the host can reuse the same parsers it hands to plugins.
 */

export { MANIFEST_FILENAME, MANIFEST_FORMAT_VERSION, parseRepoManifest } from './manifest.js';
export type { ManifestParseResult, PluginManifest, RepoManifest } from './manifest.js';

export { isPluginId, makePluginKey, makeRepoId, parsePluginId } from './ids.js';
export type { PluginId, PluginKey, RepoId } from './ids.js';

export { DisposableBag } from './disposable.js';
export type { Disposable, DisposeFn } from './disposable.js';

export { LOG_COLORS } from './events.js';
export type {
  EventBus,
  EventListener,
  EventPayload,
  HostEnvelope,
  KnownEventType,
  LogColor,
  VrcnextEventMap,
} from './events.js';

export type { ActionArgs, ActionName, Bridge, RequestOptions } from './bridge.js';

export { LOG_LEVELS } from './logger.js';
export type { Logger, LogLevel } from './logger.js';

export { coerceSetting, defaultsFor } from './settings.js';
export type {
  BooleanSetting,
  NumberSetting,
  SelectOption,
  SelectSetting,
  SettingSpec,
  SettingsSchema,
  SettingsStore,
  SettingsValues,
  StringSetting,
} from './settings.js';

export type {
  IconName,
  NavTabOptions,
  PanelHandle,
  SettingsCardOptions,
  ToastOptions,
  UiApi,
} from './ui.js';

export { definePlugin } from './plugin.js';
export type { PluginContext, VrcnextPlugin } from './plugin.js';
