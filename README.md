# vrcnext-plugin-system

A plugin runtime for [VRCNext](https://github.com/shinyflvre/VRCNext) that installs **without
modifying the VRCNext repository or its install directory**.

The host lives in VRCNext's custom-theme folder (`~/.config/VRCNext/custom-themes/`), which sits
in the config directory rather than the install tree — so a VRCNext update never removes it, and
`git pull` on the VRCNext clone stays clean.

Users install plugins by pasting a **repository URL** into the Plugins tab. One repository can
house many plugins.

---

## How it works

VRCNext injects every `.js` file in an enabled theme folder as a classic `<script>`. That script
is this host. From inside the page it has access to Photino's `window.external` channel —
VRCNext's own JS ⇄ C# bridge — which is what the plugin API is built on.

```
~/.config/VRCNext/custom-themes/vrcnext-plugin-system/
└── vrcnext-plugin-host.js      ← IIFE bundle, injected by VRCNext

        │ boots
        ▼
   plugin host  ──── IndexedDB ────  installed plugins, repos, settings
        │
        ├── EventRouter      ← window.external.receiveMessage  (~310 host events)
        ├── PhotinoBridge    → window.external.sendMessage     (~474 host actions)
        ├── Registry         ← fetches manifests + bundles from plugin repos
        ├── PluginLoader     → evaluates bundles as real ES modules (blob URLs)
        └── UiHost           → injects nav tabs / settings cards using VRCNext's own CSS classes
```

## Install

```bash
npm install
npm run build
./scripts/install-into-vrcnext.sh --dry-run
```

Close VRCNext, then run it for real. The script refuses to run while VRCNext is open, because
VRCNext rewrites `settings.json` on exit and would undo the change.

```bash
./scripts/install-into-vrcnext.sh --pin-port=51888
```

> [!IMPORTANT]
> **Pin the port.** Installed plugins live in IndexedDB, which is scoped to the page origin —
> `http://localhost:<LocalHttpPort>`. VRCNext picks a *new random port* whenever its saved one is
> unavailable, and a new port is a new origin, which would silently orphan every installed
> plugin. `--pin-port` writes `LocalHttpPort` into `settings.json` so the origin stays stable.
> Pick a free port in the 49152–65533 range.

The script backs up `settings.json` before touching it, and needs `jq` for that step. Without
`jq` it installs the files and you enable the theme manually under
**Settings → Design → Themes**.

## Writing a plugin

```bash
npm i -D @vrcnext/plugin-api
```

```ts
import { definePlugin, type PluginId, type SettingsSchema } from '@vrcnext/plugin-api';

const settings = {
  notify: { kind: 'boolean', label: 'Notify on friend online', default: true },
  tone: {
    kind: 'select',
    label: 'Tone',
    default: 'friendly',
    options: [
      { value: 'friendly', label: 'Friendly' },
      { value: 'terse', label: 'Terse' },
    ],
  },
} as const satisfies SettingsSchema;

export default definePlugin({
  id: 'friend-alerts' as PluginId,
  settings,
  activate(ctx) {
    // ctx.settings.get('tone') is 'friendly' | 'terse' — not string.
    ctx.events.on('friendTimelineEvent', (e) => {
      if (ctx.settings.get('notify') && e.type === 'online') {
        ctx.ui.toast({ message: `${e.friendName} is online.` });
      }
    });
  },
});
```

`ctx` gives you:

| Member | What it does |
| :--- | :--- |
| `ctx.events` | Subscribe to VRCNext host events. Verified payloads are typed; the rest arrive as `unknown`. |
| `ctx.bridge` | Send VRCNext actions, `request()` with response correlation, intercept outbound traffic. |
| `ctx.settings` | Schema-derived, persisted, strictly typed. `select` resolves to its literal union. |
| `ctx.ui` | Add a nav tab or a settings card, built from VRCNext's own markup so themes apply. |
| `ctx.logger` | Levelled logger, prefixed with your plugin id. |
| `ctx.disposables` | Register teardown; the host runs it on deactivate. |
| `ctx.signal` | Aborts on deactivate — pass it to every long-lived `fetch`. |

Build to a single ESM file and publish it in your repo:

```bash
npx esbuild src/index.ts --bundle --format=esm --target=es2023 --outfile=dist/friend-alerts.js
```

## Publishing a plugin repository

Put a `vrcnext-plugins.json` at the repo root. One repo, many plugins:

```json
{
  "formatVersion": 1,
  "name": "My VRCNext Plugins",
  "plugins": [
    {
      "id": "friend-alerts",
      "name": "Friend Alerts",
      "version": "1.0.0",
      "description": "Toasts when a friend comes online.",
      "entry": "dist/friend-alerts.js",
      "apiVersion": "^0.1.0"
    }
  ]
}
```

Users then paste `owner/repo`, `https://github.com/owner/repo`, a `/tree/<branch>` URL, or a
self-hosted Gitea URL. `entry` must stay inside the repository — absolute paths, URLs and `..`
segments are rejected.

## Security model

Plugins run with the **full authority of the VRCNext page**: your VRChat session, your webhooks,
your settings. There is no sandbox, and pretending otherwise would be worse than saying so.

What the host does do:

- Only `https://` repository URLs, on known forge hosts, with traversal rejected before parsing.
- Redirects refused, responses size-capped, requests timed out, credentials omitted.
- Fetched code is **stored, never executed**, until the user explicitly enables the plugin.
- A plugin's id in code must match its manifest id.
- `apiVersion` is enforced before activation.
- Everything is reversible: disabling a plugin disposes its listeners, timers and UI.

Treat a plugin repository exactly like a binary you were about to run.

## Development

```bash
npm run check      # typecheck → lint → tests → version agreement → build
npm run test
npm run build
```

The gate is strict on purpose: `tsc` with `exactOptionalPropertyTypes` and
`noUncheckedIndexedAccess`, `typescript-eslint` `strictTypeChecked`, no `any`, no non-null
assertions, no `enum`, and file/function size limits enforced by the linter.

## Layout

| Path | Contents |
| :--- | :--- |
| `packages/api` | `@vrcnext/plugin-api` — types plus pure logic (manifest parsing, settings defaults). No DOM. |
| `packages/host` | The runtime injected into VRCNext. |
| `examples/hello-world` | Minimal plugin and a sample repository manifest. |
| `scripts/` | Build, check, and the installer. |

## Compatibility

Developed against **VRCNext 2026.60.5**. The host depends on VRCNext internals that carry no
stability guarantee — the Photino bridge shape, CSS class names, `showTab()`, and the
`vrcnext:theme:unload:<id>` event. DOM selectors are centralised in
`packages/host/src/ui/dom.ts` so a VRCNext update fails loudly in one place.

## License

MIT
