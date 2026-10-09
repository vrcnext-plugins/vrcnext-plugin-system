# Working on the VRCNext plugin system

The host injected into VRCNext as a custom theme, the typed `@vrcnext/plugin-api`, and the
installer. Site pages: `plugin-system.md` (build, boot, layout, development), `install.md`,
`api-reference.md`, `permissions.md`, `plugin-json.md`, `events-and-bridge.md` and the
capability pages.

## Gate

`./scripts/check.sh` is the only gate, and it must pass before a commit. In one run: typecheck
(packages and the tooling configs), lint at `--max-warnings=0`, tests (examples and
`scripts/*.test.ts` included), the VRCNext protocol check, the reuse check, API-version
agreement, and the bundle.

There is no way to build without it. `scripts/build.sh` and `npm run build` hand control back to
the gate unless the gate invoked them, so a bundle has always been through every check — the
bridge compiles these same sources on a user's machine, where a skipped check surfaces at install
time instead.

The gate needs **Node 22 or newer**, as `engines` says: jsdom, vitest and undici all dropped
Node 20, and on it the JSDOM tests fail inside undici rather than saying what is wrong. Keep
`engines` honest — a range wider than the dependencies accept lets `npm ci` install a tree that
cannot run.

**The reuse check** (`scripts/check-reuse.mjs`) fails on a request to VRCNext, a forced-fresh
read, an outbound call, or an in-memory copy of VRChat data that does not carry a marker saying
why nothing existing answers it:

```ts
// reuse: the page holds only the window it has fetched, so a total has to come from the database
```

Write the reason, not the word — `reuse: needed` is worse than no marker, because the next reader
believes it. Before adding one, check `capabilities/vrchat/page-state.ts` for what VRCNext already
holds in the page, and `ctx.vrchat.name()` / `self()` / `moderations()` / `moderationCounts()`,
which are reads rather than lookups.

## Deploying locally

After a change to `packages/*/src`, `./scripts/deploy-to-bridge.sh` runs the gate, copies the
sources (tests stripped) into `~/.vrcnext-plugins/host/` and asks the bridge to rebuild. It stops
there: reloading the page (`vrcnext-eval 'location.reload()'`) is the owner's step, batched once
at the end. A plugin is updated by pushing its repository and `plugins/update`, which the owner
confirms on the desktop.

## VRCNext's protocol

- `protocol/vrcnext-protocol.json` and `packages/api/src/vrcnext-protocol.generated.ts` are
  generated: `npm run protocol:update -- <VRCNext checkout>`. Never edit them by hand; regenerate
  after VRCNext updates and fix what the gate then reports.
- The gate fails on an unknown action or event, an argument VRCNext never reads, an event used as
  an action, or a selector naming an element VRCNext lacks; `tsc` fails on a `VrcnextEventMap`
  field VRCNext does not send. A Windows-only action the code routes around carries
  `// vrcnext: windows-only` on its line.
- Payload fields are normalised in one place, `capabilities/vrchat/normalise.ts`.

## Where code goes

- **`ctx.vrchat` is the only way plugins read users, avatars, worlds, groups and instances.** A
  plugin sending `vrcGetFriendDetail`-style actions makes VRCNext paint its own dialogs;
  `QuietChannel` withholds the replies the host asked for. Lists VRCNext keeps anyway are
  mirrored from its pushes and requested with `swallow: false`.
- Generic helpers belong in `packages/api`, exported from `@vrcnext/plugin-api`.
- Every way the host changes VRCNext's UI is a `ctx.ui` API, and the host uses it for itself
  (`UiHost.forHost`). The host's own pages are Settings sections; its sidebar entries are
  shortcuts only.
- A new kind of setting belongs in the schema (`packages/api/src/settings.ts`, rendered by
  `packages/host/src/ui/settings/`), fed a `Binding`. Controls reuse VRCNext's own classes.
- No third-party runtime dependencies: the bridge builds `packages/*/src` with esbuild and no
  package manager. User-facing templates never go through `new Function` or `eval`.
- `examples/example-plugin` is a submodule of `vrcnext-example-plugin`: change it there, then
  commit the moved pointer here.

## Security invariants

- `ctx.native` reaches only the services in `PLUGIN_BRIDGE_SERVICES` (`notify`); the host's own
  services (`state`, `plugins`, `sql`, `logs`, `outbound`, `osc`, `remote`) stay behind its APIs.
- Events in `CREDENTIAL_EVENTS` are never granted by declaration and never reach `onAny`.
- The permission vocabulary is mirrored in the bridge's `manifest.rs`; change both, or installs of
  a plugin declaring the new name fail with `manifest_invalid`.
- `scripts/sign-plugin.mjs` is copied into every plugin repository and must keep producing the
  digest the bridge's `signing.rs` computes.

## Every repository

- **Documentation lives only on the site** ([vrcnext-plugins.github.io](https://github.com/vrcnext-plugins/vrcnext-plugins.github.io)).
  This repository keeps a compact `README.md` (name, one line, docs link, one quick-start block,
  licence) and this file, nothing else. When behaviour changes, update the site pages named below
  in the same piece of work.
- Commit messages end with a `Co-Authored-By:` trailer naming the model that wrote the commit.
- **Workflows run only by hand.** Every workflow's only trigger is `workflow_dispatch`; automatic
  triggers (`push`, `pull_request`, tags, schedules) stay commented out. Never run a workflow
  yourself — the owner dispatches them.
- Never drive VRCNext with a synthetic mouse or keyboard, and restart or reload it sparingly —
  both re-authenticate against VRChat. Inspect the page through the bridge's `remote` service
  (`vrcnext-eval '<async body>'`, bridge started with `--dev`).

## Other repositories

Each has its own `AGENTS.md`; read the one for any repository you change. Checkouts sit side by
side, so the local path is a sibling directory.

| Repository | Local | What it is |
| :--- | :--- | :--- |
| [`vrcnext-bridge`](https://github.com/vrcnext-plugins/vrcnext-bridge/blob/main/AGENTS.md) | `../vrcnext-bridge/AGENTS.md` | the native daemon: install pipeline, source policy, signing, services |
| [`vrcnext-plugins.github.io`](https://github.com/vrcnext-plugins/vrcnext-plugins.github.io/blob/main/AGENTS.md) | `../vrcnext-plugins.github.io/AGENTS.md` | the documentation site — the only docs |
| [`vrcnext-example-plugin`](https://github.com/vrcnext-plugins/vrcnext-example-plugin/blob/main/AGENTS.md) | `../vrcnext-example-plugin/AGENTS.md` | the template plugin; a submodule of the plugin system |
| [`vrcnext-club-security-plugin`](https://github.com/vrcnext-plugins/vrcnext-club-security-plugin/blob/main/AGENTS.md) | `../vrcnext-club-security-plugin/AGENTS.md` | Club Security plugin |
| [`vrcnext-bio-updater-plugin`](https://github.com/vrcnext-plugins/vrcnext-bio-updater-plugin/blob/main/AGENTS.md) | `../vrcnext-bio-updater-plugin/AGENTS.md` | Bio Updater plugin |
| [`vrcnext-patches-plugin`](https://github.com/vrcnext-plugins/vrcnext-patches-plugin/blob/main/AGENTS.md) | `../vrcnext-patches-plugin/AGENTS.md` | VRCNext Patches plugin |
