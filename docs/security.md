---
title: Security model
---

# Security model

[← Back to index](index.md)

## Plugins are not sandboxed

A plugin runs inside the VRCNext page with the **full authority of that page**: the user's
logged-in VRChat session, their Discord webhook URLs, their settings, their local image cache,
and the ~474 backend actions on the bridge.

There is no sandbox, no permission prompt, and no capability gating. Saying otherwise would be
worse than saying nothing, because it would invite users to install plugins they have not
vetted.

**Installing a plugin is equivalent to running a binary from that repository.**

## What the host actually does

Real, verifiable mitigations — none of which contain a malicious plugin once enabled:

| Control | Detail |
| :--- | :--- |
| Transport | `https://` only, known forge hosts, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`. |
| Redirects | `redirect: 'error'` — a redirect off the validated origin fails rather than following. |
| Size caps | 512 KB manifest, 8 MB bundle, enforced on both `content-length` and body. |
| Timeouts | 20 s per request. |
| Path safety | `..`, absolute paths and URLs rejected in `entry`; traversal rejected in repo URLs *before* `new URL()` normalises it away. |
| Deferred execution | Fetched code is **stored, never executed**, until the user explicitly enables it. |
| Identity check | `plugin.id` in code must equal the manifest `id`. |
| Version gating | `apiVersion` enforced before activation. |
| Reversibility | Disabling disposes listeners, timers, UI, routes and menu contributions. |
| Isolation of failure | A throwing listener, provider or route is logged and skipped, not fatal. |

## What it does not do

- ❌ No sandbox or iframe isolation — plugins share the page's global scope.
- ❌ No permission model — every plugin gets every capability.
- ❌ No code signing or checksum pinning.
- ❌ No review of what a repository serves. It can change the bundle at any time, and
  auto-update will fetch it within six hours.
- ❌ No protection between plugins — they can read each other's IndexedDB and call each other's
  routes.

## Guidance for users

- Only add repositories you would trust with your VRChat account.
- Prefer a pinned tag (`/tree/v1.2.0`) over a moving branch if you care about what auto-update
  pulls.
- The Plugins tab says this at the point of install. That is deliberate.

## Guidance for plugin authors

- Never log tokens, auth headers or message content — `ctx.logger` output is user-visible and
  gets pasted into bug reports.
- Never put secrets in settings; IndexedDB is readable by every plugin.
- Treat anything from a route handler or a fetched API as hostile: validate type, length, content.
- Use `ctx.signal` on every long-lived request so a disabled plugin stops immediately.
- Be conservative with bridge actions that mutate the user's account. There is no undo.

[← Publishing](publishing.md) · [Limitations →](limitations.md)
