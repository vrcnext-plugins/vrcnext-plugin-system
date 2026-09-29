# vrcnext-plugin-system

**A plugin runtime for [VRCNext](https://github.com/shinyflvre/VRCNext) that never touches
VRCNext.**

📖 **[Documentation for plugin authors →](https://vrcnext-plugins.github.io/)**

VRCNext ships no plugin API. This project adds one by installing itself as a VRCNext *custom
theme* — a folder under `~/.config/VRCNext/custom-themes/` whose JavaScript VRCNext injects into
its own page. That folder is in the config directory, not the install tree, so app updates leave
it alone.

The page runs **one static bundle** containing the host and every installed plugin, produced by
the **VRCNext Bridge**, a small native daemon: it clones plugin repositories, checks them, and
runs a pinned `esbuild`. The page never evaluates code at runtime, never fetches manifests and
keeps nothing in IndexedDB. Without the bridge there is no install, no state and no build.

## Install

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.sh | bash
```

**Windows** (PowerShell 5.1 or newer)

```powershell
iwr -useb https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.ps1 | iex
```

The installer fetches the bridge, a pinned `esbuild` and the host sources (every download is
checked against a `SHA256SUMS`), registers autostart, builds the first bundle and prints a
pairing token. Then, in VRCNext: enable the theme under **Settings → Design → Themes**, open the
**Plugins** tab, paste the token. Re-running the installer is an upgrade. Flags, layout and
uninstall steps are in [install/README.md](install/README.md).

## What plugins can do

| Capability | API | Permission |
| :--- | :--- | :--- |
| **Host events** — VRCNext's event stream, verified payloads typed | `ctx.events` | `host:events` |
| **Host actions** — send actions, request/response | `ctx.bridge` | `host:actions` |
| **Outbound interception** — observe or drop actions VRCNext sends | `ctx.bridge.interceptOutbound` | `host:intercept` |
| **HTTP** — the only `fetch` a plugin has; routed through the bridge, so CORS does not apply | `ctx.http` | `network` |
| **VRCNext Bridge** — VR overlay + desktop notifications, any bridge service | `ctx.native` | `native` |
| **OSC** — through VRCNext's sockets *(Windows only in VRCNext)* | `ctx.osc` | `osc` |
| **VRChat game log** — live stream and backlog | `ctx.gameLog` | `gamelog` |
| **Notifications** — toasts, confirm modals, tray/VR on Windows | `ctx.notifications` | `notifications` |
| **Context menus** | `ctx.contextMenu` | `context-menu` |
| **In-page HTTP routes** | `ctx.router` | `routes` |
| **Clipboard** | `ctx.clipboard` | `clipboard` |
| **Deep links** — the `vrcn://` links VRCNext delivers | `ctx.deepLinks` | `host:events` (`openDeepLink`) |
| **Sidebar tabs, dashboard cards, settings cards, CSS, `ui.kit`** | `ctx.ui` | none |
| **Typed persisted settings** with a rendered UI | `ctx.settings` | none |
| **Logging** — in-app Logs panel, mirrored to the bridge's `plugins.log` | `ctx.logger` | none |
| **Teardown** | `ctx.disposables`, `ctx.signal` | none |

```ts
import { definePlugin, type PluginId } from '@vrcnext/plugin-api';

export default definePlugin({
  id: 'my-plugin' as PluginId,
  activate(ctx) {
    ctx.gameLog.onType('gl_player_join', (entry) => {
      ctx.notifications.toast({ message: `${entry.message} joined.` });
    });
  },
});
```

Three limits are real and documented rather than papered over: plugin routes are **in-page
only**; **custom `vrcn://` prefixes are impossible** (VRCNext drops unknown ones in C#); **OSC and
VRCNext's own tray/VR notifications are Windows-only**, which is what the bridge's notification
targets exist for. See [Limitations](https://vrcnext-plugins.github.io/limitations).

## A plugin repository

One plugin per repository, flat, over `https://`:

```
plugin.json        the manifest below
main.ts            default-exports definePlugin({...})
src/**             optional, imported from main.ts
README.md          optional
```

```jsonc
{
  "id": "friend-alerts",            // [a-z0-9][a-z0-9-]{1,39}; equals plugin.id in main.ts
  "name": "Friend alerts",
  "version": "1.2.0",               // semver
  "apiVersion": "^0.2.0",           // range against @vrcnext/plugin-api
  "description": "…",               // <= 200 chars
  "author": "…", "homepage": "…",   // optional
  "tags": ["notifications"],        // optional, <= 8
  "permissions": ["host:events", "native"],   // categories it may ever use
  "optionalPermissions": ["network"],         // asked for later via ctx.permissions.request
  "actions": ["getFriends"],        // VRCNext actions granted at enable (host:actions)
  "events": ["friendOnline"],       // host events granted at enable (host:events)
  "hosts": ["api.example.com"]      // where the plugin means to go (network); no wildcards,
                                    // and still confirmed by the user at first use
}
```

The bridge validates this at install and update, and the host validates it again at boot,
through the same parser (`@vrcnext/plugin-api`'s `parsePluginManifest`).

Start from [vrcnext-example-plugin](https://github.com/vrcnext-plugins/vrcnext-example-plugin):
press **Use this template** on GitHub, rename the id, delete the sections you do not need, and
run its `check` script — its ESLint config mirrors the host's rules and flags the source policy
below before the bridge does. It exercises every capability, one per file, so removing a file is
how you narrow it. To try a plugin, sign it, push it and paste its URL into the Plugins tab.

### Source policy

Plugins reach the world only through `ctx.*`. Before compiling, the bridge scans every `.ts`
and `.js` file in the repository and refuses the install or update, naming the file, line and
rule, on any of: `eval(`, `new Function`, `globalThis.`, `window.` (no exceptions, not even
`window.location.href`), `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`,
`XMLHttpRequest`, bare `fetch(`, `WebSocket(`, dynamic `import(`, `<script`, `.innerHTML =`,
`insertAdjacentHTML`, `setTimeout(` with a string, `require(`, `process.`. At most 200 source
files and 2 MiB in total.

This is best-practice enforcement, not a sandbox: a plugin runs with the full authority of the
VRCNext page. Install plugins you trust.

## Permissions

Two layers, both visible to the user.

**At enable.** `permissions` in `plugin.json` is the ceiling: the categories a plugin may ever
use. Enabling opens a modal listing each one with its description and risk tone, plus the exact
`hosts`, `actions` and `events` it pre-declares. Enable grants those targets; Cancel leaves the
plugin disabled. A category that is not declared is refused outright — the call throws
`PermissionError`, nothing is asked, and the refusal is logged.

**At first use.** Inside a declared category, each *concrete* target is confirmed the first
time the plugin touches it, one modal at a time:

| Category | Asked | Title |
| :--- | :--- | :--- |
| `network` | per host, declared or not | *Plugin {name} ({id}) wants to request data from {host}* — or *send data to* for anything but GET/HEAD; details show method, URL, headers, body |
| `host:actions` | per action name | *… wants to call VRCNext action {action}*, payload in details |
| `host:events` | per event name | *… wants to listen to {event}* |
| `host:intercept` | once per plugin | *… wants to observe and drop actions VRCNext sends to its backend* |
| `native` | per `service/method` | *… wants to call the bridge: {service}/{method}*, parameters in details |
| `osc`, `gamelog` | once per plugin | |
| `clipboard` | read and write separately | |
| `notifications`, `context-menu`, `routes` | never | the declared category suffices |

Every prompt has four answers. **Confirm** allows it until VRCNext restarts. **Confirm & Save**
remembers it through the bridge's state store. **Deny** rejects the call with a `PermissionError`
naming the category and target, and is not asked again this session. **Uninstall** removes the
plugin. Identical concurrent requests share one prompt, and the steady state is one map lookup
per call. Under **Settings → Plugins → Permissions** every saved grant is listed with a Revoke
button and a Forget all; a revoked grant is simply asked about again next time, nothing restarts.

`ctx.permissions.has(p)` says whether a category is available; `ctx.permissions.request(p)`
asks for one listed in `optionalPermissions`.

Installs, updates and uninstalls are confirmed by the bridge **on the desktop** (a notification
with Confirm/Deny on Linux, a message box on Windows), not in the page.

## How the build works

```
~/.vrcnext-plugins/                     Windows: %LOCALAPPDATA%\vrcnext-plugins\
  bin/vrcnext-bridge  bin/esbuild  bin/esbuild.sha256
  host/packages/{api,host}/src/         host sources, from a release tarball
  plugins/<id>/                         one git clone per plugin
  build/static-plugins.ts               generated import table
  state.json  token  bridge.log
```

After every install, update or uninstall the bridge verifies `esbuild`'s checksum, writes
`build/static-plugins.ts` —

```ts
import p0 from '../plugins/friend-alerts/main.ts';
import m0 from '../plugins/friend-alerts/plugin.json';
export const COMPILED_PLUGINS = [{ manifest: m0, plugin: p0 }] as const;
```

— and runs `esbuild host/packages/host/src/index.ts --bundle --format=iife --target=es2022
--platform=browser --minify --sourcemap=linked --alias:@vrcnext/plugin-api=… --alias:@vrcnext/static-plugins=…`
into the theme folder, then pushes `build` over the socket. The page shows **Rebuilt — reload to
apply** with a Reload button; it never reloads on its own. The repository's own
[`scripts/build.sh`](scripts/build.sh) runs the identical flag list with the alias pointed at
[`packages/host/static-plugins.dev.ts`](packages/host/static-plugins.dev.ts), which lists the
example plugin, so `npm run check` bundles a host that runs a plugin.

At boot the host connects to the bridge (`ws://127.0.0.1:42081/v1/ws`, endpoint and token from
`localStorage`), sends `hello`, and on `welcome` reads the host namespace of the state store —
enabled flags and saved grants — then activates the enabled plugins from `COMPILED_PLUGINS` in
dependency order. Until it is connected the Plugins section shows only the Bridge card: not
detected, running, unpaired (with the token field), or connected.

## Where the host lives

The host's own pages are two sections in VRCNext's **Settings** tab, after a divider below
VRCNext's own:

| Section | What it is |
| :--- | :--- |
| **Plugin System** | Bridge card; status, platform support matrix, diagnostics, about; the live plugin + host + bridge log with level and scope filters, copy, clear and download. |
| **Plugins** | Install by URL with progress; enable with consent; updates with a commits-behind badge and changelog; uninstall; saved permissions. Every plugin's settings card follows. |

The **Plugins** group in the sidebar (mirrored in the top menu bar) holds shortcuts to those two
sections and nothing else: sidebar tabs of their own are for plugins.

## Repository layout

| Path | Contents |
| :--- | :--- |
| `packages/api` | `@vrcnext/plugin-api` — the typed contract plus pure logic (manifest parser, permission vocabulary). No DOM. |
| `packages/host` | The runtime injected into VRCNext. `permissions/` is the prompt machinery, `plugins/` the manager and gated context, `state/` the bridge state client. |
| `packages/host/static-plugins.dev.ts` | The plugin table for the repo's own build. |
| `examples/example-plugin` | A submodule of [vrcnext-example-plugin](https://github.com/vrcnext-plugins/vrcnext-example-plugin): the template plugin, checked here against the live API and bundled into the dev host. Clone with `--recurse-submodules`. |
| [`vrcnext-club-security-plugin`](https://github.com/vrcnext-plugins/vrcnext-club-security-plugin) | A complete plugin in its own repository: game log, VRChat data, presets, native and Discord notifications, tests. |
| `install/` | The one-line installers and their README. |
| `scripts/` | `build.sh`, `check.sh`, `install-into-vrcnext.sh` (copies the dev bundle into the theme folder), `sign-plugin.mjs`. |

Documentation lives in its own repository:
[vrcnext-plugins.github.io](https://github.com/vrcnext-plugins/vrcnext-plugins.github.io).
The bridge is [vrcnext-bridge](https://github.com/vrcnext-plugins/vrcnext-bridge).

## Development

```bash
git submodule update --init      # examples/example-plugin; or clone with --recurse-submodules
npm ci
npm run check      # typecheck → tooling typecheck → lint → tests → version agreement → build
```

`examples/example-plugin` is a submodule of the standalone
[vrcnext-example-plugin](https://github.com/vrcnext-plugins/vrcnext-example-plugin) repository,
so there is one copy of it rather than two that drift. The gate type-checks it against the live
`packages/api` through [`tsconfig.example.json`](tsconfig.example.json) — the workspace's own
view of those files, kept here so the submodule stays a standalone repository. Changes to the
plugin are committed in the submodule and pushed there; this repository records which commit of
it the gate ran against.

Strict by policy: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`typescript-eslint` `strictTypeChecked`, no `any`, no non-null assertions, no `enum`, no lint
suppressions. Size limits are machine-enforced: 100 lines per function, 1000 per file, 4
parameters, depth 3 (ESLint), with a 600-line soft warning from `size-limits.test.ts`.

The permission broker, the state client, the settings store, the compiled-table reader and the
bridge socket are unit-tested without a DOM. The modals, the manager panel and the boot sequence
are not, and neither has been exercised inside a running VRCNext against a real bridge yet.

## Security

Plugins run with the **full authority of the VRCNext page**: the user's VRChat session, webhooks
and settings. The permission model makes each capability declared and each concrete use
confirmed; the source policy refuses the obvious ways off the `ctx.*` path, and the bridge's
build refuses a plugin that imports a file outside its own directory. Neither is a sandbox: the
page's DOM (VRCNext's own login form included) is not covered by any permission, and an element
a plugin creates can still load a URL. See
[Security model](https://vrcnext-plugins.github.io/security).

`ctx.http` goes through the bridge's `outbound` service rather than the page, because the page
can only read from hosts that allow cross-origin reads and most plain HTTP APIs do not. That is
more reach than a browser has (the bridge refuses loopback, private and link-local addresses, so
not this machine's own network), so **no host is pre-granted**, not even one listed in `hosts`: the user is asked about each one the first time a
plugin goes there, and may save the answer. Declaring a host says where the plugin means to go.
Only the user says it may.

## License

[Unlicense](LICENSE) — public domain.
