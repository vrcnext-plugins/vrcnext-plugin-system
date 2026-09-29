# Working on the VRCNext plugin system

Read this before changing anything here. It records what the owner has asked for; the code
style rules live in the repo's lint config and in `scripts/check.sh`.

## Verify without touching the desktop

- **Never drive VRCNext with a synthetic mouse or keyboard.** The bridge has a token-gated
  `remote` service for that: `vrcnext-eval '<async function body>'` runs a snippet in the page
  and prints the result. `host`, `text(sel)`, `click(sel)`, `visible(sel)`, `rects(sel)` and
  `sleep(ms)` are in scope. Measure layouts with `rects`, read text with `text`, open tabs by
  clicking the host's own buttons.
- **Restart VRCNext and reload its page sparingly.** Both re-authenticate against the VRChat
  API. Batch every host change into one deploy, rebuild once, and reload once at the end with
  `vrcnext-eval 'location.reload()'`. Never restart the app when a reload will do.
- After a change to `packages/*/src`, run `./scripts/deploy-to-bridge.sh`: it runs the gate,
  copies the sources (tests stripped) into `~/.vrcnext-plugins/host/packages/*/src`, finds the
  bridge's port in the unit's journal and `POST`s `/v1/plugins/build`. It deliberately stops
  there — reloading the page is the owner's step. A plugin is updated by pushing its own repo and
  `POST /v1/plugins/update`, which needs the desktop confirmation.

## Reading VRChat data

- **`ctx.vrchat` is the only way a plugin reads users, avatars, worlds, groups and instances.**
  Never make a plugin send `vrcGetFriendDetail`-style actions itself: VRCNext's own dispatcher
  paints (or opens) a modal for those replies. The host's `QuietChannel` wraps the callbacks
  Photino registered before ours, so a reply the host asked for is withheld from VRCNext and the
  screen does not change.
- Lists VRCNext keeps anyway (friends, favourites, your groups, the current instance) are
  mirrored from its pushes and asked for with `swallow: false`, because VRCNext handling those
  replies is what keeps its own lists fresh.
- Payload field names are read out of the VRCNext C# source, not guessed, and normalised in one
  place (`capabilities/vrchat/normalise.ts`).

## Where code goes

- **Generic helpers belong in `packages/api`**, exported from `@vrcnext/plugin-api`, never
  copied into a plugin. `timeAgo`, `renderTemplate` and friends are the pattern. Ask "would a
  second plugin want this?" before writing a utility under `examples/example-plugin/src`.
- **`examples/example-plugin` is a git submodule** of `vrcnext-example-plugin`. Edit it there and
  commit inside the submodule, then commit the moved pointer here; there is no copy to sync. The
  workspace type-checks it through `tsconfig.example.json` rather than the submodule's own
  `tsconfig.json`, which describes it as the standalone repository it also is.
- **Every way the host injects or changes VRCNext UI is a `ctx.ui` API**, and the host uses
  that same API for itself (`UiHost.forHost`). Settings sections, dividers, sidebar groups, tabs,
  cards: one implementation, and disabling a plugin removes everything it added.
- The host's own pages are Settings sections (Plugin System, Plugins). Sidebar entries from the
  host are shortcuts only; real sidebar tabs are for plugins.
- Prefer reusable, flexible building blocks (kit widgets, options objects) over one-off markup.
- **A new kind of setting belongs in the schema, not in a plugin's own panel.** `packages/api/src/settings.ts`
  declares the kind and how a stored value is repaired; `packages/host/src/ui/settings/` renders it.
  Every control is fed a `Binding`, so the same code draws a top-level setting, a field of an
  `object` and a field of a `list` item — and a nested edit still ends in one `store.set`.
- Controls reuse VRCNext's own classes (`.fs-slider`, `.fd-profile-item-small`, `.vrcn-edit-field`).
  If a control needs a look VRCNext has, find its class rather than writing CSS.
- **Third-party runtime dependencies are effectively unavailable**: the bridge builds from
  `packages/*/src` with esbuild and no package manager, so anything not in those sources cannot
  be resolved. Write the small thing (the template engine is 500 lines) rather than vendoring a
  megabyte; user-facing templates must never go through `new Function` or `eval`.

## What ships

- The bridge bundles from each plugin's `main.ts` with esbuild; only imported files end up in
  the bundle, so `*.test.ts` files are never bundled. They *are* tracked in the flat plugin repos
  (bio-updater and club-security both carry them), which matters because the source policy scans
  every `.ts` in the tree, bundled or not — a test that fakes `ctx.http` has to write the word
  `fetch`, and that alone refuses the whole plugin. Unresolved; see the note below.
  Keep plugins small: no dev-only code behind a runtime flag.
- **A plugin that tests its HTTP path currently cannot be updated.** `bio-updater` is refused with
  `policy: src/sources.test.ts:17 fetch` for a test fake implementing `HttpApi`. The fix is either
  for the policy to skip `*.test.ts` — guarded the way `EXEMPT_PATHS` already is by
  `imports_exempt_file`, so nothing bundled can import one — or for the flat repos to stop tracking
  tests. Narrowing the policy's scope is the owner's call, so neither has been done.
- `plugin.json` descriptions are capped at 200 characters and the source policy also scans
  comments (`window.`, `eval(`, `fetch(` and similar are refused, even in prose).

## The permission vocabulary lives in two places

`packages/api/src/permissions.ts` and `crates/vrcnext-bridge-plugins/src/manifest.rs` in the
bridge. The bridge validates every `plugin.json` against its own copy, so adding a permission
means adding it there too, rebuilding the bridge (`./scripts/build.sh`), copying the binary to
`~/.vrcnext-plugins/bin/` and restarting `vrcnext-bridge.service` — otherwise installing a plugin
that declares the new name fails with `manifest_invalid`.

## Gate

`./scripts/check.sh` (typecheck, lint, tests including examples, build) must pass before a
commit. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
