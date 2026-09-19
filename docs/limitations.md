---
title: Limitations
---

# Limitations

[← Back to index](index.md)

An honest list of what this host **cannot** do, and why. Each entry was verified against the
VRCNext source at 2026.60.5 rather than assumed.

## Impossible without patching VRCNext

| Want | Why not |
| :--- | :--- |
| **Externally reachable HTTP routes** | VRCNext's server is a C# `HttpListener` with a fixed route table. The page cannot add to it; the router wraps `fetch`, which external requests never touch. |
| **Custom `vrcn://` prefixes** | `DeepLinkService.Parse` validates against a closed list and returns `null` otherwise, so unknown prefixes are dropped in C# before the page sees them. |
| **Writing to disk** | The page has no filesystem access. Plugin code, settings and the registry live in IndexedDB. |
| **Self-updating the host** | The host is a file in VRCNext's theme folder. It can detect a new release, not install one. |
| **Interleaving context-menu items** | `getMenuConfig` is module-closure-scoped; contributions are appended after VRCNext's own items. |
| **New OSC ports** | VRCNext owns the sockets. Plugins send and receive through it, sharing one OSCQuery advertisement. |

## Fragile by nature

These work, but depend on VRCNext internals with no stability guarantee:

- **CSS class names and selectors** (`vrcn-panel-card`, `sf-toggle-row`, `#tab0`, `#sidebarEl`).
  Centralised in `packages/host/src/ui/dom.ts` so a break is loud and one-line to fix.
- **`showTab(i)` indexes by position** among `.tab` elements, not by id. Injected tabs compute
  their index at injection time.
- **The Photino bridge shape** (`window.external.sendMessage` / `receiveMessage`). On Linux the
  inbound side is an array that `receiveMessage` pushes onto, which is what lets the host observe
  events without displacing VRCNext's handler.
- **`request()` correlation** is by event type only — VRCNext has no request ids.
- **Event payloads** other than the seven verified ones are `unknown` on purpose.

## Environmental gotchas

- **Port pinning is mandatory in practice.** IndexedDB is scoped to
  `http://localhost:<LocalHttpPort>`; VRCNext picks a new random port when its saved one is
  taken, and a new origin orphans every installed plugin. Install with `--pin-port`.
- **NVIDIA on Linux:** VRCNext re-executes itself to set `WEBKIT_DISABLE_DMABUF_RENDERER=1`, so
  you will see two processes. Export it yourself to skip the double launch.
- **`install_vrcnext.sh` does not register `vrcn://`** — its `.desktop` lacks `MimeType=` and
  `%u`. The AppImage build does.
- **Windows is untested.** The design is cross-platform (WebView2 exposes the same
  `receiveMessage` contract), but this host has only been developed against Linux.

## Verification status

The build, the type gate and the unit tests are green. The DOM injection, IndexedDB persistence
and the installer have **not** been exercised inside a running VRCNext. Treat UI behaviour as
unverified until you have run it.

[← Security model](security.md) · [API reference →](api-reference.md)
