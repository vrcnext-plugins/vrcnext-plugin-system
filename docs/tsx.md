---
title: Using TSX
---

# Using `.tsx` in a plugin

[← Back to index](index.md)

**Short answer: yes — but you bring your own renderer.**

## VRCNext uses no framework at all

Verified against VRCNext 2026.60.5: no React, no Preact, no Vue, no JSX anywhere. No `.tsx` or
`.jsx` files, no `package.json`, no bundler. The entire frontend is hand-written vanilla
JavaScript, loaded as plain `<script>` tags, manipulating the DOM directly.

So there is **no host renderer to share**. If you want JSX you must bundle your own, and it adds
to your plugin's download size.

## Recommended: Preact

~3 KB minified, full JSX support, no host dependency.

```bash
npm i preact
npm i -D typescript esbuild
```

`tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2023",
    "lib": ["ES2023", "DOM"]
  }
}
```

`src/panel.tsx`:

```tsx
import { render } from 'preact';

interface StatsProps {
  readonly joins: number;
}

function Stats({ joins }: StatsProps) {
  return (
    <div class="mp-grid">
      <div class="mp-stat">
        <div class="mp-label">Player joins</div>
        <div class="mp-value">{joins}</div>
      </div>
    </div>
  );
}

export function mountStats(container: HTMLElement, joins: number): void {
  render(<Stats joins={joins} />, container);
}
```

`src/index.ts`:

```ts
import { definePlugin, type PluginId } from '@vrcnext/plugin-api';
import { mountStats } from './panel.js';   // .js specifier, .tsx source

export default definePlugin({
  id: 'my-plugin' as PluginId,
  activate(ctx) {
    let joins = 0;
    ctx.ui.addNavTab({
      label: 'My Plugin',
      icon: 'extension',
      render: (tab) => { mountStats(tab, joins); },
    });
    ctx.gameLog.onType('OnPlayerJoined', () => { joins += 1; });
  },
});
```

Build exactly as for a plain plugin — esbuild handles `.tsx` natively:

```bash
npx esbuild src/index.ts --bundle --format=esm --target=es2023 --minify --outfile=dist/my-plugin.js
```

## Unmount on deactivate

Preact's `render(null, container)` tears the tree down. The host removes your panel element
anyway, but components holding timers or subscriptions need the explicit unmount:

```ts
const handle = ctx.ui.addNavTab({ /* … */ });
ctx.disposables.add(() => { render(null, handle.element); });
```

## React works too, but weigh it

React + react-dom is roughly 45 KB minified versus Preact's ~3 KB, and every plugin bundles its
own copy — there is no sharing between plugins. For panels made of a few cards and a list,
plain DOM or Preact is the proportionate choice.

## Style it with the host's classes

Whatever renderer you pick, keep using VRCNext's CSS classes and variables (see
[UI injection](ui.md)) so your panel follows the user's theme. JSX changes how you build the
markup, not what the markup should be.

[← Logging](logging.md) · [Back to index](index.md)
