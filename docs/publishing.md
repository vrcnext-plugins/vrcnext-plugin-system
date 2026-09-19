---
title: Publishing
---

# Publishing

[← Back to index](index.md)

## The manifest

One `vrcnext-plugins.json` at your repository root describes every plugin it houses.

```json
{
  "formatVersion": 1,
  "name": "My VRCNext Plugins",
  "plugins": [
    {
      "id": "friend-alerts",
      "name": "Friend Alerts",
      "version": "1.2.0",
      "description": "Toasts when a friend comes online.",
      "entry": "dist/friend-alerts.js",
      "apiVersion": "^0.1.0",
      "author": "you",
      "homepage": "https://github.com/you/my-plugins",
      "icon": "notifications"
    }
  ]
}
```

| Field | Rules |
| :--- | :--- |
| `id` | Required. Lowercase kebab-case, 3–64 chars. Must equal `plugin.id` in code. |
| `version` | Required. Semver — auto-update compares with it. |
| `entry` | Required. Repo-relative path to the built ESM bundle. |
| `apiVersion` | Required. Semver **range** of `@vrcnext/plugin-api`. |
| `name`, `description`, `author`, `homepage`, `icon` | `name` required; rest optional. |

`entry` is rejected if it is absolute, contains `://`, uses backslashes, or has any `.` or `..`
segment — it must stay inside the repository.

## Parsing is forgiving by design

One malformed entry is skipped with a warning; the rest of the manifest still loads. A duplicate
`id` keeps the first. A `formatVersion` newer than the host supports rejects the whole file with
a message telling the user to update.

## Supported repository URLs

| Form | Example |
| :--- | :--- |
| Shorthand (GitHub) | `owner/repo` |
| GitHub URL | `https://github.com/owner/repo` |
| Branch or tag | `https://github.com/owner/repo/tree/release/2026` |
| Self-hosted Gitea | `https://git.example.com/owner/repo` |

Only `https://`. Traversal segments are rejected before URL parsing, so a normalising `..`
cannot silently retarget a different repository.

## Commit your `dist/`

Users fetch the built file directly — the host never runs your build. If `dist/` is gitignored,
your plugin cannot be installed.

## Versioning and auto-update

The host checks on boot and every six hours: it re-reads each repo manifest and re-downloads any
plugin whose manifest `version` is **strictly newer** by semver than the installed one. If the
plugin was running it is restarted; **settings are preserved** because they are keyed separately
from the bundle.

Consequences:

- Bump `version` on every release or nobody gets the update.
- Prereleases sort *below* their release: `1.0.0-beta.1` does not update over `1.0.0`.
- A non-semver `version` is treated as "no update available".
- Pushing to the tracked branch ships to every user within six hours. Tag a branch in the repo
  URL (`/tree/stable`) if you want a slower channel.

### `apiVersion` gating

Checked before activation. If the host's API version does not satisfy your range, the plugin is
refused with a message naming both versions. Widen the range only when you have actually tested
against the newer API.

### Host auto-update

The host **detects** a newer release and tells the user, but cannot install it: it is a file in
VRCNext's theme folder and the page cannot write to disk. Updating means re-running
`scripts/install-into-vrcnext.sh`.

[← Routes & deep links](routes-and-links.md) · [Security model →](security.md)
