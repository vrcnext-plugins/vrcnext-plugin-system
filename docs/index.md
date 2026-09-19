---
title: VRCNext Plugin System
---

# VRCNext Plugin System

Build plugins for [VRCNext](https://github.com/shinyflvre/VRCNext) — **without modifying VRCNext.**

VRCNext ships no plugin API. This project adds one by installing itself as a VRCNext *custom
theme*: a folder under `~/.config/VRCNext/custom-themes/` whose JavaScript VRCNext injects into
its own page. That folder lives in the config directory, not the install tree, so app updates
leave it alone and a `git pull` on a VRCNext clone stays clean.

Users install plugins by pasting a **repository URL**. One repository can house many plugins.

## Documentation

| Page | What it covers |
| :--- | :--- |
| [Getting started](getting-started.md) | Install the host, scaffold a plugin, see it load. |
| [Plugin anatomy](plugin-anatomy.md) | `definePlugin`, lifecycle, disposal, the context object. |
| [Settings](settings.md) | Declarative schema, type inference, persistence. |
| [Events & the bridge](events-and-bridge.md) | Host events, sending actions, interception. |
| [UI injection](ui.md) | Nav tabs, dashboard cards, settings cards, toasts, CSS. |
| [Notifications](notifications.md) | In-app, desktop tray, **SteamVR overlay**, confirm modals. |
| [Logging](logging.md) | Levelled logger, the Logs panel, downloading logs. |
| [Using TSX](tsx.md) | JSX in plugins, and why VRCNext itself has no framework. |
| [Context menus](context-menus.md) | Items, dividers, submenus, entity targets. |
| [OSC](osc.md) | Sending and receiving OSC through VRCNext. |
| [Game log](game-log.md) | The VRChat log stream and backlog. |
| [Routes & deep links](routes-and-links.md) | In-page HTTP routes, `vrcn://` links, and their limits. |
| [Publishing](publishing.md) | The manifest format, versioning, auto-update. |
| [Security model](security.md) | What plugins can do, and what the host does about it. |
| [Limitations](limitations.md) | What is genuinely impossible without patching VRCNext. |
| [API reference](api-reference.md) | Every exported type, one page. |

## Thirty-second version

```ts
import { definePlugin, type PluginId } from '@vrcnext/plugin-api';

export default definePlugin({
  id: 'my-plugin' as PluginId,
  activate(ctx) {
    ctx.gameLog.onType('OnPlayerJoined', (entry) => {
      ctx.ui.toast({ message: `Joined: ${entry.detail}` });
    });
  },
});
```

Bundle it to one ESM file, list it in `vrcnext-plugins.json` at your repo root, push, and paste
the repo URL into the Plugins tab.

## Honest scope

Two things are **not possible** from a theme-injected host, and this project does not pretend
otherwise:

1. **Real HTTP routes.** VRCNext's web server is a C# `HttpListener` with a fixed route table.
   Plugin routes work inside the page only — `curl` cannot reach them. See
   [Routes & deep links](routes-and-links.md).
2. **Custom `vrcn://` prefixes.** VRCNext validates the link type in C# against a closed list and
   drops anything else before the page ever sees it. Plugins can observe the six built-in
   prefixes, not add a seventh.

Everything else on this site is implemented and type-checked against VRCNext **2026.60.5**.
