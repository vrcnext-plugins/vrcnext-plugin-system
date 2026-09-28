# VRCNext Example Plugin

A working VRCNext plugin that uses **every capability the host provides**, one per file, so you
can start from it and delete what you do not need.

> Press **Use this template** on GitHub, or clone it. It installs and runs as-is — enable it and
> you get a nav tab, a dashboard card, a settings section, context-menu entries, OSC, the game
> log, notifications and an in-page HTTP route, all of them live.

## Making it yours

1. **Rename it.** `id`, `name`, `description`, `author` and `homepage` in `plugin.json`, and
   `id` in `main.ts` to match — the host refuses to activate a plugin whose two ids disagree.
   An id is `[a-z0-9][a-z0-9-]{1,39}` and is also the directory the bridge clones into.
2. **Delete the sections you do not need.** Every `install*` call in `main.ts` is one file under
   `src/sections/`. Remove the line, remove the file, and remove what it needed from
   `permissions`, `events` and `hosts`. Declaring less is the point: each category is shown to
   the user with a risk tone when they enable your plugin.
3. **Trim `src/settings.ts`.** It demonstrates every setting kind the host can render, which is
   far more than a real plugin wants. The host derives both the stored type and the control from
   this schema, so there is no form and no parser anywhere in the plugin.
4. **Make a signing key and sign it.** See [Signing](#signing). The bridge will not install an
   unsigned repository.

## What is in here

| File | Capability |
| :--- | :--- |
| `main.ts` | the manifest of sections; the only file you must edit |
| `src/settings.ts` | every setting kind, including a `list`, an `embed` and a `custom` control |
| `src/state.ts` | the session state the sections share, and the one function they log through |
| `src/sections/events.ts` | typed host events, the untyped escape hatch, settings changes |
| `src/sections/game-log.ts` | the VRChat game log: live, by type, and the backlog |
| `src/sections/osc.ts` | OSC in and out, guarded on `available` (Windows only) |
| `src/sections/deep-links.ts` | `wrld:` / `usr:` links VRCNext delivers |
| `src/sections/routes.ts` | in-page HTTP routes, reachable from this page and nothing else |
| `src/sections/context-menu.ts` | items, dividers, submenus, and the clipboard |
| `src/sections/notifications.ts` | toasts, VRCNext-styled notifications, OS and VR |
| `src/sections/native.ts` | the bridge: VR overlay and desktop targets, asked for by name |
| `src/sections/http.ts` | outbound HTTP behind an optional permission |
| `src/sections/vrchat.ts` | friends, groups, the current instance, avatars — no dialogs |
| `src/sections/ui-nav-tab.ts` | a whole tab from `ctx.ui.kit` — **the UI file to copy** |
| `src/sections/ui-dashboard.ts` | the same job in plain DOM, plus a modal and an entity picker |
| `src/sections/ui-settings-section.ts` | a Settings section of the plugin's own, and sidebar shortcuts |

Everything registered through `ctx` — listeners, panels, routes, timers on `ctx.disposables` —
is torn down when the plugin is disabled, and `ctx.signal` aborts at the same moment. That is
why `deactivate` is empty.

## The manifest

| Field | Meaning |
| :--- | :--- |
| `id` | `[a-z0-9][a-z0-9-]{1,39}`; also the clone directory name on the bridge |
| `name`, `version` (semver), `apiVersion` (semver range), `description` (≤ 200 chars) | required |
| `author`, `homepage`, `tags` (≤ 8) | optional |
| `permissions` | the categories the plugin may ever use; an undeclared one is refused outright |
| `optionalPermissions` | categories asked for later through `ctx.permissions.request(p)` |
| `actions`, `events`, `hosts` | exact names granted at enable; anything else is confirmed by the user on first use |

Categories: `host:events` `host:actions` `host:intercept` `network` `notifications` `native`
`osc` `gamelog` `context-menu` `routes` `clipboard`. `ui`, `settings`, `logger` and
`disposables` need none.

## Source policy

Plugins reach the world only through `ctx.*`. Before compiling, the bridge scans every
`.ts`/`.js` file and refuses the install or update, naming file, line and rule, on:

`eval(` · `new Function` · `globalThis.` · `window.` (no exceptions) · `document.cookie` ·
`localStorage` · `sessionStorage` · `indexedDB` · `XMLHttpRequest` · bare `fetch(` ·
`WebSocket(` · dynamic `import(` · `<script` · `.innerHTML =` · `insertAdjacentHTML` ·
`setTimeout(` with a string · `require(`

It also refuses source **shaped** so that scan could not work: minified or packed files, runs of
`\xNN` escapes, `_0x`-mangled identifiers, long high-entropy blobs, and zero-width or
bidirectional-override characters. Ship images as files rather than inlining them as `data:`
URIs, which a text scan cannot tell from a payload.

At most 200 source files and 2 MiB in total, no symlinks. `eslint.config.mjs` here reports most
of it as lint errors, so `npm run check` finds it before the bridge does.

## Signing

Every plugin must carry a `plugin.sig` signed by the key it is installed under; a different key
stops the user's update with its own confirmation. Once, on a machine you control:

```bash
node scripts/sign-plugin.mjs keygen
```

Keep `vrcnext-signing-key.txt` out of the repository (`.gitignore` already covers it), and put
its fingerprint in this README so users can compare it against what VRCNext shows them.

This repository's own releases are signed by:

```
1bc6-e13e-c44c-3bd0-f5a8-5618-8b9b-919c
``` Then,
for each release, from a clean working tree:

```bash
node scripts/sign-plugin.mjs sign --key /path/to/vrcnext-signing-key.txt
node scripts/sign-plugin.mjs verify
git commit -am "Sign"
```

`.github/workflows/sign.yml` does the same on a runner from a `VRCNEXT_SIGNING_KEY` repository
secret. **Its automatic trigger is commented out** — see the note in the file — so enable it by
uncommenting `push:` in your fork.

## Working on it

```bash
npm install
npm run check      # tsc --noEmit && eslint .
```

`@vrcnext/plugin-api` is the typed API. Nothing is bundled here: the VRCNext Bridge compiles the
repository together with the host, so `main.ts` is imported as TypeScript straight from the
clone. `tsconfig.json` is the host's own strict configuration and `eslint.config.mjs` mirrors
its rules — no `any`, no non-null assertions, no `enum`, 100 lines per function, 1000 per file,
4 parameters, depth 3.

## Installing it

Paste the repository's `https://` URL into VRCNext's **Settings → Plugins**. The bridge clones
the default branch, validates the manifest, scans the source, checks the signature, asks you to
confirm on the desktop, and rebuilds. Reload VRCNext and enable it.

Documentation: <https://vrcnext-plugins.github.io/>
