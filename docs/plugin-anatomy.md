---
title: Plugin anatomy
---

# Plugin anatomy

[← Back to index](index.md)

## The module contract

A plugin bundle **default-exports one object**. The host verifies it has a string `id` and a
callable `activate` before doing anything else, and refuses to load it otherwise.

```ts
import { definePlugin, type PluginId, type SettingsSchema } from '@vrcnext/plugin-api';

export default definePlugin({
  id: 'my-plugin' as PluginId,
  settings,                 // optional
  activate(ctx) { /* … */ },
  deactivate() { /* … */ }, // optional
});
```

### Why `definePlugin`

It is an identity function whose only job is to pin the settings schema generic. Without it, an
inline plugin object widens `S` to `SettingsSchema` and every setting degrades to
`boolean | number | string`. With it, `ctx.settings.get('mode')` keeps its literal union.

### The id must match twice

`plugin.id` in code must equal `id` in the repository manifest. The loader compares them and
refuses to activate on a mismatch — this catches copy-pasted manifests pointing at the wrong
bundle.

## Lifecycle

| Phase | What happens |
| :--- | :--- |
| **Install** | Bundle is downloaded and stored. Nothing is executed. |
| **Enable** | `apiVersion` checked → bundle evaluated → `activate(ctx)` called. |
| **Disable** | `deactivate()` awaited → every `ctx` registration disposed → blob URL revoked. |
| **Update** | Disable, re-download, enable. Settings survive; they are keyed separately. |
| **Uninstall** | Disable, then bundle *and* settings are deleted. |

If `activate` throws, the host disposes everything the plugin registered, revokes the blob URL,
and rolls the enabled flag back so the UI never shows a plugin as running when it is not.

## Disposal

Everything registered through `ctx` is tracked and reversed automatically:

```ts
activate(ctx) {
  ctx.events.on('friendTimelineEvent', handler);  // auto-removed
  ctx.ui.addNavTab({ /* … */ });                  // auto-removed
  ctx.router.get('stats', handler);               // auto-unmounted

  // Anything you create yourself, register explicitly:
  const timer = setInterval(tick, 30_000);
  ctx.disposables.add(() => { clearInterval(timer); });
}
```

Disposers run in **reverse registration order**, and one throwing does not strand the rest.

### `ctx.signal`

Aborts on deactivate. Pass it to every long-lived `fetch` so a disabled plugin stops its network
work immediately:

```ts
const response = await fetch(url, { signal: ctx.signal });
```

## The context object

| Member | Page |
| :--- | :--- |
| `ctx.id`, `ctx.version` | Manifest identity. |
| `ctx.logger` | Levelled logger, prefixed with your id. `.scoped('sync')` for sub-scopes. |
| `ctx.settings` | [Settings](settings.md) |
| `ctx.events` | [Events & the bridge](events-and-bridge.md) |
| `ctx.bridge` | [Events & the bridge](events-and-bridge.md) |
| `ctx.ui` | [UI injection](ui.md) |
| `ctx.contextMenu` | [Context menus](context-menus.md) |
| `ctx.osc` | [OSC](osc.md) |
| `ctx.gameLog` | [Game log](game-log.md) |
| `ctx.router`, `ctx.deepLinks` | [Routes & deep links](routes-and-links.md) |
| `ctx.disposables`, `ctx.signal` | Above. |

[← Getting started](getting-started.md) · [Settings →](settings.md)
