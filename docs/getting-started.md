---
title: Getting started
---

# Getting started

[← Back to index](index.md)

## 1. Install the host

```bash
git clone https://github.com/vrcnext-plugins/vrcnext-plugin-system
cd vrcnext-plugin-system
npm install
npm run build
```

Close VRCNext, then install. The script refuses to run while VRCNext is open, because VRCNext
rewrites `settings.json` on exit and would undo the change.

```bash
./scripts/install-into-vrcnext.sh --dry-run
./scripts/install-into-vrcnext.sh --pin-port=51888
```

> **Pin the port.** Installed plugins live in IndexedDB, scoped to the page origin
> `http://localhost:<LocalHttpPort>`. VRCNext picks a *new random port* whenever its saved one is
> unavailable, and a new port is a new origin — which would silently orphan every installed
> plugin. `--pin-port` writes `LocalHttpPort` into `settings.json` so the origin stays put. Pick
> a free port in 49152–65533.

Start VRCNext. A **Plugins** entry appears in the sidebar.

## 2. Scaffold a plugin

```bash
mkdir my-plugin && cd my-plugin
npm init -y
npm i -D @vrcnext/plugin-api esbuild typescript
```

`src/index.ts`:

```ts
import { definePlugin, type PluginId } from '@vrcnext/plugin-api';

export default definePlugin({
  id: 'my-plugin' as PluginId,
  activate(ctx) {
    ctx.logger.info('Hello from my-plugin.');
    ctx.ui.toast({ message: 'my-plugin is running.' });
  },
});
```

## 3. Build one ESM bundle

```bash
npx esbuild src/index.ts --bundle --format=esm --target=es2023 --outfile=dist/my-plugin.js
```

The host evaluates this file as a real ES module, so it must default-export the plugin. Do not
bundle as IIFE — that is the *host's* format, not a plugin's.

## 4. Publish a manifest

`vrcnext-plugins.json` at your repo root:

```json
{
  "formatVersion": 1,
  "name": "My VRCNext Plugins",
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "description": "Does a useful thing.",
      "entry": "dist/my-plugin.js",
      "apiVersion": "^0.1.0"
    }
  ]
}
```

Commit `dist/` — users fetch the built file directly, they do not build your plugin.

## 5. Install it

Push, then in VRCNext open **Plugins**, paste `owner/repo`, press Add, then Install and enable.

## Development loop

Editing a plugin means rebuilding and reinstalling, which is slow. While iterating, paste your
bundle straight into the devtools console instead:

```bash
WEBKIT_INSPECTOR_SERVER=127.0.0.1:2999 /opt/vrcnext/VRCNext
```

VRCNext leaves WebKit developer extras enabled, so `Ctrl+Shift+I` may also work. Its frontend
calls `preventDefault()` on `contextmenu`, so right-click → Inspect is suppressed.

[← Back to index](index.md) · [Plugin anatomy →](plugin-anatomy.md)
