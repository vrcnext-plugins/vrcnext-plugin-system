# vrcnext-plugin-system

**A plugin runtime for [VRCNext](https://github.com/shinyflvre/VRCNext) that never touches
VRCNext.**

📖 **[Documentation for plugin authors →](https://vrcnext-plugins.github.io/vrcnext-plugin-system/)**

VRCNext ships no plugin API. This project adds one by installing itself as a VRCNext *custom
theme* — a folder under `~/.config/VRCNext/custom-themes/` whose JavaScript VRCNext injects into
its own page. That folder is in the config directory, not the install tree, so app updates leave
it alone and a `git pull` on a VRCNext clone stays clean.

Users install plugins by pasting a **repository URL** into the Plugins tab. One repository can
house many plugins, and both plugins and the host auto-update.

---

## What plugins can do

| Capability | API |
| :--- | :--- |
| **Host events** — ~310 VRCNext event types, verified payloads typed | `ctx.events` |
| **Host actions** — ~474 backend actions, with request/response and outbound interception | `ctx.bridge` |
| **OSC** — send and receive through VRCNext's sockets, incl. avatar parameters | `ctx.osc` |
| **VRChat game log** — live stream and 1000-entry backlog | `ctx.gameLog` |
| **Sidebar tabs, dashboard cards, settings cards, custom CSS** | `ctx.ui` |
| **Notifications** — in-app toasts, OS tray toasts, **SteamVR wrist overlay**, confirm modals | `ctx.notifications` |
| **Context menus** — items, dividers, submenus, entity-aware targeting | `ctx.contextMenu` |
| **In-page HTTP routes** with path params | `ctx.router` |
| **Deep links** — observe the `vrcn://` links VRCNext delivers | `ctx.deepLinks` |
| **Typed persisted settings** with a rendered UI | `ctx.settings` |
| **Levelled logging** — console + live in-app Logs panel + persisted + downloadable | `ctx.logger` |
| **Automatic teardown** | `ctx.disposables`, `ctx.signal` |

```ts
import { definePlugin, type PluginId } from '@vrcnext/plugin-api';

export default definePlugin({
  id: 'my-plugin' as PluginId,
  activate(ctx) {
    ctx.gameLog.onType('OnPlayerJoined', (entry) => {
      ctx.ui.toast({ message: `${entry.detail} joined.` });
    });
    ctx.osc.send('VRCEmote', 'int', 3);
  },
});
```

Two limits are real and documented rather than papered over: plugin HTTP routes are
**in-page only**, and **custom `vrcn://` prefixes are impossible** — VRCNext validates the link
type in C# and drops unknown ones before the page sees them. See
[Limitations](https://vrcnext-plugins.github.io/vrcnext-plugin-system/limitations).

## Install

```bash
npm install && npm run build
./scripts/install-into-vrcnext.sh --dry-run
```

Close VRCNext, then run it for real. The script refuses to run while VRCNext is open, because
VRCNext rewrites `settings.json` on exit and would undo the change.

```bash
./scripts/install-into-vrcnext.sh --pin-port=51888
```

> [!IMPORTANT]
> **Pin the port.** Installed plugins live in IndexedDB, scoped to the page origin
> `http://localhost:<LocalHttpPort>`. VRCNext picks a *new random port* whenever its saved one is
> unavailable, and a new origin silently orphans every installed plugin. `--pin-port` writes
> `LocalHttpPort` into `settings.json` so the origin stays put. Pick a free port in 49152–65533.

The script backs up `settings.json` first and needs `jq` for that step; without it, enable the
theme manually under **Settings → Design → Themes**.

## How it works

```
~/.config/VRCNext/custom-themes/vrcnext-plugin-system/
└── vrcnext-plugin-host.js      ← IIFE bundle, injected by VRCNext as a classic <script>

        │ boots
        ▼
   plugin host  ──── IndexedDB ────  installed plugins, repos, settings
        │
        ├── EventRouter      ← window.external.receiveMessage
        ├── PhotinoBridge    → window.external.sendMessage
        ├── Registry         ← manifests + bundles from plugin repositories
        ├── PluginLoader     → evaluates bundles as real ES modules (blob URLs)
        ├── RouteTable       → wraps fetch for /plugins/<id>/…
        ├── ContextMenuHub   → appends into VRCNext's rendered menu
        ├── UiHost           → nav tabs, dashboard and settings cards
        ├── LogSink          → console + ring buffer + IndexedDB + downloadable .log
        └── Updater          → plugin auto-update; host update detection
```

## Repository layout

| Path | Contents |
| :--- | :--- |
| `packages/api` | `@vrcnext/plugin-api` — the typed contract plus pure logic. No DOM. |
| `packages/host` | The runtime injected into VRCNext. |
| `examples/kitchen-sink` | Reference plugin exercising **every** capability, with custom CSS. |
| `examples/hello-world` | Minimal plugin. |
| `docs/` | The documentation site. |
| `scripts/` | `build.sh`, `check.sh`, `install-into-vrcnext.sh`. |

## Development

```bash
npm run check      # typecheck → tooling typecheck → lint → tests → version agreement → build
npm test
npm run build
```

Strict by policy: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`typescript-eslint` `strictTypeChecked`, no `any`, no non-null assertions, no `enum`. There are
**no lint suppressions** in the codebase.

Size limits are machine-enforced, not eyeballed:

| Limit | Enforced by | Behaviour |
| :--- | :--- | :--- |
| 100 lines per function | ESLint `max-lines-per-function` | Fails the gate |
| 1000 lines per file | ESLint `max-lines` | Fails the gate |
| 600 lines per file (soft) | `size-limits.test.ts` | Names the file, does not fail |
| 4 parameters, depth 3 | ESLint `max-params`, `max-depth` | Fails the gate |

`dist/` is minified with source maps — the host bundle is ~42 KB.

## Compatibility and verification status

Developed against **VRCNext 2026.60.5**. The host depends on VRCNext internals with no stability
guarantee — the Photino bridge shape, CSS class names, `showTab()` indexing, and the
`vrcnext:theme:unload:<id>` event. Selectors are centralised in
`packages/host/src/ui/dom.ts` so a VRCNext update fails loudly in one place.

Type check, lint, unit tests and build are green. **DOM injection, IndexedDB persistence and the
installer have not yet been exercised inside a running VRCNext** — treat runtime UI behaviour as
unverified until you have run it.

## Security

Plugins run with the **full authority of the VRCNext page**: the user's VRChat session, webhooks
and settings. There is no sandbox. Installing a plugin is equivalent to running a binary from
that repository, and the UI says so at the point of install. See
[Security model](https://vrcnext-plugins.github.io/vrcnext-plugin-system/security).

## License

[Unlicense](LICENSE) — public domain.
