---
title: Context menus
---

# Context menus

[← Back to index](index.md)

```ts
ctx.contextMenu.contribute((target) => [
  { kind: 'divider' },
  {
    kind: 'item',
    icon: 'content_copy',
    label: 'Copy element tag',
    onSelect: () => navigator.clipboard.writeText(target.element.tagName),
  },
  {
    kind: 'submenu',
    icon: 'tune',
    label: 'Mode',
    items: () => MODES.map((m) => ({
      kind: 'item' as const,
      icon: 'radio_button_checked',
      label: m.label,
      checked: ctx.settings.get('mode') === m.value,
      onSelect: () => void ctx.settings.set('mode', m.value),
    })),
  },
]);
```

## Entry kinds

| Kind | Fields |
| :--- | :--- |
| `item` | `icon`, `label`, `onSelect`, optional `danger`, `checked` |
| `submenu` | `icon`, `label`, `items()` — resolved when opened, so it can reflect live state |
| `divider` | none |

## Targeting

```ts
// Only on friend rows.
ctx.contextMenu.contributeFor('.friend-row', (target) => [ /* … */ ]);
```

`target.entity` is populated when VRCNext tagged the element with a VRChat entity:

```ts
if (target.entity?.type === 'user') {
  entries.push({ kind: 'item', icon: 'badge', label: 'Copy user id',
                 onSelect: () => navigator.clipboard.writeText(target.entity.id) });
}
```

## Standalone menus

```ts
element.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  ctx.contextMenu.open(event.clientX, event.clientY, entries);
});
```

## How it works, and what that costs

VRCNext builds its menus inside a module closure — `getMenuConfig` is unreachable from outside.
So contributions are **appended to the rendered menu** rather than merged into its item list: a
capture-phase `contextmenu` listener records the target, and a `MutationObserver` appends plugin
buttons once VRCNext has drawn its own.

Consequences worth knowing:

- Plugin entries always land **at the bottom**. You cannot interleave with native items.
- Your buttons carry their own listeners, so VRCNext's internal callback array is untouched.
- Providers run on **every menu open** — keep them cheap.
- A provider that throws is logged and skipped; the menu still opens.

[← Using TSX](tsx.md) · [OSC →](osc.md)
