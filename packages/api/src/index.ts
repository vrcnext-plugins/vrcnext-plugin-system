/**
 * `@vrcnext/plugin-api` — the contract between a VRCNext plugin and the plugin host.
 *
 * This package is types plus a little pure logic (manifest parsing, permissions, settings
 * defaults). It has
 * no DOM side effects and no host dependency, so plugin authors can unit-test against it and
 * the host can reuse the same parsers it hands to plugins.
 */

export { MANIFEST_FILENAME, MANIFEST_LIMITS, PLUGIN_TAGS, parsePluginManifest } from './manifest.js';
export type { ManifestParseResult, PluginManifest, PluginSummary, PluginTag } from './manifest.js';

export { PLUGIN_ID_PATTERN, isPluginId, parsePluginId } from './ids.js';
export type { PluginId } from './ids.js';

export {
  PERMISSIONS,
  PERMISSION_NAMES,
  PermissionError,
  isPermission,
  permissionInfo,
} from './permissions.js';
export type { Permission, PermissionInfo, PermissionTone, PermissionsApi } from './permissions.js';

export type { HttpApi } from './http.js';
export type { ClipboardApi } from './clipboard.js';

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

export { coerceSetting, defaultOf, defaultsFor, defineCustomSetting, settingFlag } from './settings.js';
export type {
  AvatarScope,
  AvatarSetting,
  BooleanSetting,
  ColorSetting,
  CustomSetting,
  CustomSettingHost,
  EmbedSetting,
  EmbedTemplate,
  EntityKind,
  EntitySetting,
  GroupScope,
  GroupSetting,
  InferSetting,
  InstanceScope,
  InstanceSetting,
  ListSetting,
  MultiSelectSetting,
  NumberSetting,
  ObjectSetting,
  SelectOption,
  SelectSetting,
  SettingBase,
  SettingPredicate,
  SettingSpec,
  SettingsSchema,
  SettingsStore,
  SettingsValues,
  StringSetting,
  TimeSetting,
  UserScope,
  UserSetting,
  WorldScope,
  WorldSetting,
} from './settings.js';
export { ENTITY_SCOPES, coerceEntity, entityScopes, isEntityId } from './settings-entity.js';
export { EMBED_COLORS, EMBED_LIMITS, EMPTY_EMBED, coerceEmbed, completeEmbed } from './settings-embed.js';
export type { EmbedField } from './settings-embed.js';
export { parseEmbedColor, renderEmbed, webhookPayload } from './discord-embed.js';
export { discordCode, discordTimestamp } from './discord-text.js';
export type { DiscordTimeStyle } from './discord-text.js';
export type { DiscordEmbed, DiscordWebhookPayload, RenderEmbedOptions } from './discord-embed.js';

export { PERFORMANCE_RANKS, RANK_EMOJI, TRUST_RANKS, rankEmoji, rankIndex, rankLabel, trustRank } from './vrchat.js';
export { trustRankLevel, trustScore, trustScoreEmoji, yearsOnVrchat } from './trust.js';
export type { TrustCriterion, TrustInput, TrustScore } from './trust.js';
export type {
  PerformanceRank,
  TrustRank,
  VrcAvatar,
  VrcAvatarSummary,
  VrcFavoriteGroup,
  VrcFriendInstance,
  VrcGroup,
  VrcGroupSummary,
  VrcInstance,
  VrcInstanceUser,
  VrcLookupOptions,
  VrcModerationCounts,
  VrcSearchOptions,
  VrcSearchPage,
  VrcSelf,
  VrcTimelineEvent,
  VrcUser,
  VrcUserSummary,
  VrcWorld,
  VrcWorldSummary,
  VrchatApi,
} from './vrchat.js';

export type {
  NativeApi,
  NativeNotifyFields,
  NativeNotifyOptions,
  NativeNotifyOverride,
  NativeNotifyResult,
  NativeTarget,
  NativeUrgency,
} from './native.js';
export type {
  UiBadgeTone,
  UiButtonOptions,
  UiCardOptions,
  UiChild,
  UiChipsOptions,
  UiDropdownOptions,
  UiGridOptions,
  UiKit,
  UiListItemOptions,
  UiRowOptions,
  UiSliderOptions,
  UiStatOptions,
  UiStatusCardOptions,
  UiStatusTone,
  UiTextAreaOptions,
  UiTextFieldOptions,
  UiToggleRowOptions,
  UiTypedFieldOptions,
} from './ui-kit.js';
export { OSC_VALUE_KINDS } from './osc.js';
export type { OscApi, OscAvatarChangeEvent, OscParamEvent, OscValue, OscValueKind } from './osc.js';

export { GAME_LOG_TYPES } from './game-log.js';
export type { GameLogApi, GameLogEntry, GameLogType } from './game-log.js';

export { NOTIFY_ACCENTS, NOTIF_TOAST_KINDS } from './notifications.js';
export type {
  ConfirmOptions,
  DesktopNotifyOptions,
  NotificationsApi,
  NotifToastKind,
  NotifToastOptions,
  NotifyAccent,
} from './notifications.js';

export { DEEP_LINK_PREFIXES } from './links.js';
export type {
  DeepLinkApi,
  DeepLinkEvent,
  DeepLinkPrefix,
  RouteHandler,
  RouteRequest,
  RouterApi,
} from './links.js';

export type {
  ContextMenuApi,
  ContextMenuDivider,
  ContextMenuEntry,
  ContextMenuItem,
  ContextMenuProvider,
  ContextMenuSubmenu,
  ContextMenuTarget,
} from './context-menu.js';

export type {
  DashboardCardOptions,
  EntityPickOptions,
  IconName,
  NavTabOptions,
  PanelHandle,
  SettingsCardOptions,
  SettingsSectionHandle,
  SettingsSectionOptions,
  SidebarGroupOptions,
  SidebarShortcut,
  ToastOptions,
  UiApi,
} from './ui.js';

export { formatDuration, newestFirst, timeAgo } from './time.js';
export type { Timestamped, TimeInput } from './time.js';
export { INSTANCE_TYPES, INSTANCE_TYPE_LABELS, instanceTypeLabel, isGroupInstance, parseLocation } from './location.js';
export { formatUserEvent, recentUserEvents, userEventLines } from './timeline.js';
export type { TimelineEntry, TimelineFormat, TimelineTextOptions } from './timeline.js';
export type { InstanceType, ParsedLocation } from './location.js';
export { TemplateError, renderTemplate, stringify, templatePlaceholders, truthy, validateTemplate } from './template.js';
export type { RenderOptions, TemplateValue, TemplateValues } from './template.js';

export { definePlugin } from './plugin.js';
export type { PluginContext, VrcnextPlugin } from './plugin.js';
export { compareVersions, isRange, isVersion, parseRange, parseVersion, satisfies } from './semver.js';
