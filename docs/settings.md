---
title: Settings
---

# Settings

[← Back to index](index.md)

Declare a schema once. The host derives the persisted value type *and* renders the settings UI
from it — you never write a form or a parser.

```ts
const settings = {
  enabled: { kind: 'boolean', label: 'Enabled', default: true },
  threshold: { kind: 'number', label: 'Threshold', default: 5, min: 0, max: 10, step: 1 },
  note: { kind: 'string', label: 'Note', default: '', placeholder: 'Optional' },
  mode: {
    kind: 'select',
    label: 'Mode',
    default: 'all',
    options: [
      { value: 'all', label: 'All friends' },
      { value: 'favorites', label: 'Favorites only' },
    ],
  },
} as const satisfies SettingsSchema;
```

> `as const satisfies SettingsSchema` is load-bearing. `as const` preserves the literal option
> values; `satisfies` checks the shape without widening it. Drop either and `mode` becomes
> `string`.

## Reading and writing

```ts
ctx.settings.get('enabled');   // boolean
ctx.settings.get('mode');      // 'all' | 'favorites'  ← not string
ctx.settings.values;           // the whole object, synchronous

await ctx.settings.set('mode', 'favorites');  // 'nope' is a compile error
await ctx.settings.reset();
```

`values` is synchronous because everything is loaded once at activation — reading a setting
inside a hot event handler should not await IndexedDB.

## Reacting to changes

```ts
ctx.disposables.add(
  ctx.settings.onChange((values) => {
    ctx.logger.info(`Mode is now ${values.mode}.`);
  }),
);
```

Fires for writes from your code *and* from the settings UI.

## Validation and migration

Every persisted value is re-validated against the schema on load. Anything that no longer
matches falls back to the default:

| Situation | Result |
| :--- | :--- |
| Stored value has the wrong type | Default used. |
| Number outside `min`/`max` | Clamped into range. |
| `select` value no longer in `options` | Default used. |
| Key removed from the schema | Ignored. |
| Key added to the schema | Default used. |

So changing a setting's kind or removing an option between versions is safe — no migration code,
no crash on upgrade.

## Where it is stored

IndexedDB, keyed by `<repo>#<plugin-id>`. Settings survive updates (the bundle is keyed
separately) and are deleted on uninstall.

> **Never put secrets here.** IndexedDB is readable by anything running in the page, including
> other plugins. There is no secret storage in this host.

[← Plugin anatomy](plugin-anatomy.md) · [Events & the bridge →](events-and-bridge.md)
