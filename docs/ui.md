---
title: UI injection
---

# UI injection

[← Back to index](index.md)

All UI is built from **VRCNext's own CSS classes**, so plugin panels inherit the user's theme,
font-size offset and any active custom theme. Hand-rolling a `<button>` loses all three.

## Sidebar tab

```ts
ctx.ui.addNavTab({
  label: 'My Plugin',
  icon: 'extension',          // Material Symbols Rounded ligature
  render: (tab) => {
    tab.appendChild(ctx.ui.createCard('Status', 'monitoring'));
  },
});
```

`render` is called **once, lazily**, the first time the tab is opened.

VRCNext rebuilds its sidebar whenever the nav editor saves, which drops injected buttons. The
host re-attaches via a `MutationObserver` — no polling, no lost button.

## Dashboard card

```ts
ctx.ui.addDashboardCard({
  title: 'My Plugin',
  icon: 'insights',
  order: 10,                  // lower sorts earlier among plugin cards
  render: (card) => { card.appendChild(buildChart()); },
});
```

Also re-attached automatically when VRCNext re-renders the dashboard.

## Settings card

```ts
ctx.ui.addSettingsCard({
  title: 'My Plugin',
  icon: 'tune',
  render: (card) => {
    card.appendChild(
      ctx.ui.createToggleRow('Enable feature', ctx.settings.get('enabled'), (checked) => {
        void ctx.settings.set('enabled', checked);
      }),
    );
  },
});
```

## Toasts

```ts
ctx.ui.toast({ message: 'Saved.' });
ctx.ui.toast({ message: 'Could not reach the API.', ok: false });
```

Routed through VRCNext's own toast renderer when available, else to the plugin log.

## Custom CSS

```ts
ctx.ui.injectCss(`
  .mp-grid { display: grid; gap: 10px; }
  .mp-value { color: var(--tx0); font-variant-numeric: tabular-nums; }
`);
```

Removed on deactivate. **Use VRCNext's CSS variables** rather than literal colours so your panel
follows the theme:

| Variable | Use |
| :--- | :--- |
| `--tx0` / `--tx2` / `--tx3` | Primary / secondary / tertiary text |
| `--bg-input` | Inset panel background |
| `--fs-off` | User font-size offset — add it: `calc(13px + var(--fs-off, 0px))` |

Prefix your class names (`.mp-`) — the page is a single shared document.

## Builders

| Call | Produces |
| :--- | :--- |
| `ctx.ui.createCard(title, icon)` | A `vrcn-panel-card` with a header. |
| `ctx.ui.createToggleRow(label, checked, onChange)` | An `sf-toggle-row` with a themed switch. |

Every injector returns a `PanelHandle` with `.element` and `.dispose()`, and is disposed
automatically with the plugin.

[← Events & the bridge](events-and-bridge.md) · [Notifications →](notifications.md)
