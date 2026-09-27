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
- After a change to `packages/*/src`, deploy by copying the sources (tests stripped) into
  `~/.vrcnext-plugins/host/packages/*/src` and `POST /v1/plugins/build` on the bridge. A plugin
  is updated by pushing its flat repo and `POST /v1/plugins/update`.

## Where code goes

- **Generic helpers belong in `packages/api`**, exported from `@vrcnext/plugin-api`, never
  copied into a plugin. `timeAgo`, `fillTemplate` and friends are the pattern. Ask "would a
  second plugin want this?" before writing a utility under `examples/*/src`.
- **Every way the host injects or changes VRCNext UI is a `ctx.ui` API**, and the host uses
  that same API for itself (`UiHost.forHost`). Settings sections, dividers, sidebar groups, tabs,
  cards: one implementation, and disabling a plugin removes everything it added.
- The host's own pages are Settings sections (Plugin System, Plugins). Sidebar entries from the
  host are shortcuts only; real sidebar tabs are for plugins.
- Prefer reusable, flexible building blocks (kit widgets, options objects) over one-off markup.

## What ships

- The bridge bundles from each plugin's `main.ts` with esbuild; only imported files end up in
  the bundle. `*.test.ts` files are never bundled, and the flat plugin repos do not carry them.
  Keep plugins small: no dev-only code behind a runtime flag.
- `plugin.json` descriptions are capped at 200 characters and the source policy also scans
  comments (`window.`, `eval(`, `fetch(` and similar are refused, even in prose).

## Gate

`./scripts/check.sh` (typecheck, lint, tests including examples, build) must pass before a
commit. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
