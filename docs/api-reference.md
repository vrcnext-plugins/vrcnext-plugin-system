---
title: API reference
---

# API reference

[← Back to index](index.md)

Everything exported from `@vrcnext/plugin-api`. Types are authoritative in the package; this is
the map.

## Entry

```ts
function definePlugin<const S extends SettingsSchema>(plugin: VrcnextPlugin<S>): VrcnextPlugin<S>;

interface VrcnextPlugin<S> {
  readonly id: PluginId;
  readonly settings?: S;
  activate(ctx: PluginContext<S>): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```

## `PluginContext`

| Member | Type |
| :--- | :--- |
| `id` | `PluginId` |
| `version` | `string` |
| `logger` | `Logger` |
| `settings` | `SettingsStore<S>` |
| `events` | `EventBus` |
| `bridge` | `Bridge` |
| `ui` | `UiApi` |
| `osc` | `OscApi` |
| `gameLog` | `GameLogApi` |
| `deepLinks` | `DeepLinkApi` |
| `router` | `RouterApi` |
| `contextMenu` | `ContextMenuApi` |
| `disposables` | `DisposableBag` |
| `signal` | `AbortSignal` |

## Identifiers

`PluginId` · `PluginKey` · `RepoId` — branded strings.
`isPluginId()` · `parsePluginId()` · `makePluginKey()` · `makeRepoId()`

## Settings

`SettingsSchema` · `SettingsValues<S>` · `SettingsStore<S>` · `SettingSpec`
`BooleanSetting` · `NumberSetting` · `StringSetting` · `SelectSetting<V>` · `SelectOption<V>`
`defaultsFor()` · `coerceSetting()`

```ts
interface SettingsStore<S> {
  readonly values: SettingsValues<S>;
  get<K extends keyof S>(key: K): SettingsValues<S>[K];
  set<K extends keyof S>(key: K, value: SettingsValues<S>[K]): Promise<void>;
  reset(): Promise<void>;
  onChange(listener: (values: SettingsValues<S>) => void): () => void;
}
```

## Events

```ts
interface EventBus {
  on<T extends string>(type: T, listener: EventListener<T>): () => void;
  once<T extends string>(type: T, listener: EventListener<T>): () => void;
  onAny(listener: (envelope: HostEnvelope) => void): () => void;
  next<T extends string>(type: T, signal?: AbortSignal): Promise<EventPayload<T>>;
}
```

`VrcnextEventMap` — verified payloads: `setPlatform` · `log` · `toast` · `dbMigrationProgress` ·
`openDeepLink` · `friendTimelineEvent` · `customThemes`. Anything else is `unknown`.

## Bridge

```ts
interface Bridge {
  send(action: ActionName, args?: ActionArgs): void;
  request<T extends string>(action, args, options: RequestOptions & { expect: T }): Promise<EventPayload<T>>;
  interceptOutbound(fn: (action: ActionName, raw: string) => boolean | undefined): () => void;
}
```

## UI

```ts
interface UiApi {
  addNavTab(options: NavTabOptions): PanelHandle;
  addDashboardCard(options: DashboardCardOptions): PanelHandle;
  addSettingsCard(options: SettingsCardOptions): PanelHandle;
  injectCss(css: string): PanelHandle;
  toast(options: ToastOptions): void;
  createCard(title: string, icon: IconName): HTMLElement;
  createToggleRow(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement;
}
```

## Context menu

```ts
interface ContextMenuApi {
  contribute(provider: ContextMenuProvider): () => void;
  contributeFor(selector: string, provider: ContextMenuProvider): () => void;
  open(x: number, y: number, entries: readonly ContextMenuEntry[]): void;
}
```

`ContextMenuEntry` = `ContextMenuItem | ContextMenuSubmenu | ContextMenuDivider`

## OSC

```ts
interface OscApi {
  connect(): void;
  disconnect(): void;
  send(name: string, kind: 'bool', value: boolean): void;
  send(name: string, kind: 'int' | 'float', value: number): void;
  sendRaw(address: string, kind: 'bool', value: boolean): void;
  sendRaw(address: string, kind: 'int' | 'float', value: number): void;
  onParam(listener: (event: OscParamEvent) => void): () => void;
  onAvatarChange(listener: (event: OscAvatarChangeEvent) => void): () => void;
}
```

## Game log

```ts
interface GameLogApi {
  on(listener: (entry: GameLogEntry) => void): () => void;
  onType(type: string, listener: (entry: GameLogEntry) => void): () => void;
  history(signal?: AbortSignal): Promise<readonly GameLogEntry[]>;
}
```

## Routes and deep links

```ts
interface RouterApi {
  readonly base: URL;
  route(method: string, pattern: string, handler: RouteHandler): () => void;
  get(pattern: string, handler: RouteHandler): () => void;
  post(pattern: string, handler: RouteHandler): () => void;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

interface DeepLinkApi {
  on(listener: (event: DeepLinkEvent) => boolean | undefined): () => void;
  onPrefix(prefix: DeepLinkPrefix, listener: (event: DeepLinkEvent) => boolean | undefined): () => void;
}
```

## Manifest and disposal

`parseRepoManifest()` · `RepoManifest` · `PluginManifest` · `ManifestParseResult`
`MANIFEST_FILENAME` · `MANIFEST_FORMAT_VERSION`
`DisposableBag` · `Disposable` · `DisposeFn`
`Logger` · `LogLevel` · `LOG_LEVELS` · `LogColor` · `LOG_COLORS`

[← Limitations](limitations.md) · [Back to index](index.md)
