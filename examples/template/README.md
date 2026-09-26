# VRCNext plugin template

The recommended starting point for a plugin repository. Copy this directory into a new git
repository, rename the id, push, and paste the repository's `https://` URL into VRCNext's
Plugins tab.

## The rules

A plugin is **one flat repository**:

```
plugin.json        the manifest; validated by the bridge at install and by the host at boot
main.ts            default-exports definePlugin({...}); its `id` must equal plugin.json's
src/**             optional, imported from main.ts
README.md          optional
```

`plugin.json`:

| Field | Meaning |
| :--- | :--- |
| `id` | `[a-z0-9][a-z0-9-]{1,39}`; also the clone directory name on the bridge |
| `name`, `version` (semver), `apiVersion` (semver range), `description` (≤ 200 chars) | required |
| `author`, `homepage`, `tags` (≤ 8) | optional |
| `permissions` | the categories the plugin may ever use; an undeclared one is refused outright |
| `optionalPermissions` | categories asked for later through `ctx.permissions.request(p)` |
| `actions`, `events`, `hosts` | exact names granted when the plugin is enabled; anything else is confirmed by the user on first use |

Categories: `host:events` `host:actions` `host:intercept` `network` `notifications` `native`
`osc` `gamelog` `context-menu` `routes` `clipboard`. `ui`, `settings`, `logger` and
`disposables` need none.

## Source policy

Plugins reach the world only through `ctx.*`. The bridge scans every `.ts`/`.js` file before
compiling and refuses the install or update, naming the file, line and rule, on:

`eval(` · `new Function` · `globalThis.` · `window.` (no exceptions) · `document.cookie` ·
`localStorage` · `sessionStorage` · `indexedDB` · `XMLHttpRequest` · bare `fetch(` ·
`WebSocket(` · dynamic `import(` · `<script` · `.innerHTML =` · `insertAdjacentHTML` ·
`setTimeout(` with a string · `require(` · `process.`

At most 200 source files and 2 MiB in total. The `eslint.config.mjs` here reports most of these
as lint errors so you find them before the bridge does.

## Working on it

```bash
npm install --save-dev typescript eslint @eslint/js typescript-eslint
npm install @vrcnext/plugin-api      # or a file: link to a checkout of packages/api
npm run check
```

`tsconfig.json` is the host's own strict configuration and `eslint.config.mjs` mirrors its
rules (no `any`, no non-null assertions, no `enum`, 100 lines per function, 1000 per file, 4
parameters, depth 3). Nothing is bundled here: the VRCNext Bridge compiles the repository
together with the host, so `main.ts` is imported as TypeScript straight from the clone.

Everything registered through `ctx` — listeners, panels, routes, timers via `ctx.disposables` —
is torn down when the plugin is disabled. `ctx.signal` aborts at the same moment; pass it to
anything long-lived.
