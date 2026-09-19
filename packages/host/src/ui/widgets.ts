/**
 * VRCNext's own widgets, as builders.
 *
 * Every class name here was read out of the VRCNext frontend and is reused verbatim rather than
 * re-implemented, so panels inherit the app's spacing, typography, borders and theme variables and
 * keep matching it through theme changes and VRCNext updates. Nothing in this file styles anything
 * itself — if a panel needs a look that is not here, the right move is to find VRCNext's class for
 * it and add a builder, not to write inline CSS.
 *
 * | Builder | VRCNext markup |
 * | :--- | :--- |
 * | {@link panelLayout} | `.settings-content` — the scrolling, gapped column every settings tab uses |
 * | {@link card} | `.vrcn-panel-card` + `.vrcn-panel-card-header` |
 * | {@link statusCard} | `.vrcn-panel-card.status` + `.sf-status-row` + `.sf-dot` |
 * | {@link row} | `.sf-toggle-row` — label left, control right, rules between siblings |
 * | {@link toggle} | `.toggle` > `.toggle-track` > `.toggle-knob` |
 * | {@link button} | `.vrcn-button` |
 * | {@link textField} | `.vrcn-edit-field` |
 * | {@link dropdown} | `.vrcn-dropdown` |
 * | {@link description} | `.set-desc` |
 * | {@link sectionLabel} | `.sf-section-label` |
 */

import type { UiBadgeTone, UiChild } from '@vrcnext/plugin-api';

import { element, iconSpan } from './dom.js';

/**
 * The only CSS this project writes.
 *
 * Everything else reuses a VRCNext class. These have no VRCNext equivalent: the app builds a
 * bespoke grid per feature (`.dash-rank-grid`, `.av-perf-grid`, …) rather than exposing a general
 * one, and has no stat tile at all. They are named `vrcnx-` so they cannot collide, and are built
 * from the same variables as the rest of the app so they track the active theme.
 */
// Two rules in here are load-bearing and easy to "tidy" into bugs:
//
// - `grid-auto-flow: row dense` back-fills the gap a full-width card would otherwise leave as an
//   orphan cell.
// - `.vrcnx-full` uses `grid-column: 1 / -1`, not `span 2`. A fixed span overflows the panel once
//   the grid has collapsed to a single column on a narrow window, because the span conjures an
//   implicit second column. `1 / -1` means "every column there currently is".
//
// Kept as TS comments rather than CSS ones because backticks inside this template literal would
// terminate it.
const KIT_CSS = `
.vrcnx-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--vrcnx-grid-min, 280px), 1fr));
  gap: 16px;
  align-items: start;
  grid-auto-flow: row dense;
}
.vrcnx-grid > .vrcnx-full { grid-column: 1 / -1; }
.vrcnx-stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; min-width: 0; }
.vrcnx-stat-value {
  font-size: calc(20px + var(--fs-off, 0px));
  font-weight: 700;
  color: var(--tx0);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.vrcnx-stat-label {
  font-size: calc(10px + var(--fs-off, 0px));
  font-weight: 600;
  color: var(--tx2);
  text-transform: uppercase;
  letter-spacing: .5px;
}
`;

const STYLE_ID = 'vrcnext-plugins-kit-style';

/** Injected once, on first use. Idempotent across host reboots. */
export function ensureKitStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = element('style');
  style.id = STYLE_ID;
  style.textContent = KIT_CSS;
  document.head.appendChild(style);
}

/** Flatten a child list, dropping `false`/`null`/`undefined` so conditionals need no ceremony. */
export function appendChildren(parent: Node, children: readonly UiChild[]): void {
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Replace a node's children. The intended way to refresh a panel in place. */
export function setChildren(parent: Node, children: readonly UiChild[]): void {
  while (parent.firstChild !== null) parent.removeChild(parent.firstChild);
  appendChildren(parent, children);
}

/**
 * A responsive grid of cards.
 *
 * The default choice when a panel has more than one card: full-width cards stacked vertically
 * waste most of a wide window.
 */
export function grid(children: readonly UiChild[], min = 280): HTMLElement {
  ensureKitStyles();
  const root = element('div', 'vrcnx-grid');
  root.style.setProperty('--vrcnx-grid-min', `${String(min)}px`);
  appendChildren(root, children);
  return root;
}

/** Two cards side by side, using VRCNext's own pair container. */
export function pair(first: UiChild, second: UiChild): HTMLElement {
  const root = element('div', 'vrcn-panel-card-pair');
  appendChildren(root, [first, second]);
  return root;
}

/** A small coloured pill, from VRCNext's badge set. */
export function badge(tone: UiBadgeTone, text: string): HTMLElement {
  // `neutral` is spelled `hidden` in VRCNext's stylesheet; that name is meaningless outside its
  // instance-privacy context, so the kit exposes the colour rather than the jargon.
  return element('span', `vrcn-badge ${tone === 'neutral' ? 'hidden' : tone}`, text);
}

/** A big number with a caption. */
export function stat(label: string, text: string, tone?: UiBadgeTone): HTMLElement {
  ensureKitStyles();
  const root = element('div', 'vrcnx-stat');
  const number = element('div', 'vrcnx-stat-value', text);
  if (tone === 'ok' || tone === 'warn' || tone === 'err') {
    number.style.color = `var(--${tone})`;
  }
  root.append(number, element('div', 'vrcnx-stat-label', label));
  return root;
}

/**
 * The column a tab's content lives in.
 *
 * VRCNext's settings tabs put their cards inside `.settings-content`, which supplies the padding,
 * the 16px gap between cards and the scroll container. Appending cards straight into a tab — which
 * is what these panels used to do — produces flush, edge-to-edge cards with no breathing room.
 */
export function panelLayout(children?: readonly UiChild[]): HTMLElement {
  const root = element('div', 'settings-content');
  if (children !== undefined) appendChildren(root, children);
  return root;
}

/** A titled card. Pass no title for a bare card, as VRCNext does for status strips. */
export function card(title?: string, icon?: string, children?: readonly UiChild[]): HTMLElement {
  const root = element('div', 'vrcn-panel-card');

  if (title !== undefined) {
    const header = element('div', 'vrcn-panel-card-header');
    if (icon !== undefined) header.appendChild(iconSpan(icon));
    header.appendChild(element('span', undefined, title));
    root.appendChild(header);
  }
  if (children !== undefined) appendChildren(root, children);
  return root;
}

/**
 * The compact status strip VRCNext uses at the top of its tool tabs: a coloured dot and a label on
 * the left, an action on the right.
 */
export function statusCard(options: {
  readonly online: boolean;
  readonly label: string;
  readonly action?: HTMLElement;
}): HTMLElement {
  const root = element('div', 'vrcn-panel-card status');
  const strip = element('div', 'sf-status-row');

  const status = element('div', 'sf-status');
  status.appendChild(element('span', `sf-dot ${options.online ? 'online' : 'offline'}`));
  status.appendChild(element('span', undefined, options.label));

  strip.appendChild(status);
  if (options.action !== undefined) strip.appendChild(options.action);
  root.appendChild(strip);
  return root;
}

/** Body copy under a card header. */
export function description(text: string): HTMLElement {
  return element('div', 'set-desc', text);
}

/** An uppercase label that groups rows inside a card. */
export function sectionLabel(text: string): HTMLElement {
  return element('div', 'sf-section-label', text);
}

/**
 * A label/control row.
 *
 * `.sf-toggle-row` draws its own separator between consecutive siblings, so a run of these inside
 * one card reads as a proper list without any extra markup.
 */
export function row(label: string, control?: Node, detail?: string): HTMLElement {
  const root = element('div', 'sf-toggle-row');

  if (detail === undefined) {
    root.appendChild(element('span', undefined, label));
  } else {
    // VRCNext's two-line variant: the label with a muted explanation stacked under it.
    //
    // It spells this `.sf-desc` in settings.html, but that class has no CSS rule anywhere in the
    // frontend — it renders at full size there too. `.set-desc` is the real muted style; its
    // bottom margin is the only thing that has to go, since this one sits inside a row.
    const stack = element('div');
    stack.style.minWidth = '0';
    stack.appendChild(element('div', undefined, label));

    const note = element('div', 'set-desc', detail);
    note.style.margin = '2px 0 0';
    stack.appendChild(note);
    root.appendChild(stack);
  }

  if (control !== undefined) root.appendChild(control);
  return root;
}

/**
 * The muted right-hand value in a read-only row.
 *
 * Sized to match the status spans VRCNext puts beside its own buttons, which carry this exact
 * declaration inline.
 */
export function value(text: string): HTMLElement {
  const node = element('span', undefined, text);
  node.style.cssText = 'font-size:calc(12px + var(--fs-off, 0px));color:var(--tx2);white-space:nowrap;';
  return node;
}

/** VRCNext's switch. */
export function toggle(checked: boolean, onChange: (next: boolean) => void): HTMLElement {
  const wrapper = element('label', 'toggle');

  const input = element('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => { onChange(input.checked); });

  const track = element('div', 'toggle-track');
  track.appendChild(element('div', 'toggle-knob'));

  wrapper.append(input, track);
  return wrapper;
}

/** VRCNext's button, with the optional leading icon its own buttons use. */
export function button(options: {
  readonly label: string;
  readonly icon?: string;
  readonly onClick: () => void;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly round?: boolean;
}): HTMLButtonElement {
  const base = options.round === true ? 'vrcn-button-round' : 'vrcn-button';
  const node = element('button', options.active === true ? `${base} active` : base);
  if (options.disabled === true) node.disabled = true;
  if (options.icon !== undefined) {
    const icon = iconSpan(options.icon);
    // Matches the inline sizing VRCNext applies to icons inside its buttons.
    icon.style.fontSize = '16px';
    node.appendChild(icon);
  }
  node.appendChild(element('span', undefined, options.label));
  node.addEventListener('click', options.onClick);
  return node;
}

/** A horizontal strip of controls, spaced like VRCNext's own button rows. */
export function controlRow(...children: readonly Node[]): HTMLElement {
  const root = element('div');
  root.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
  root.append(...children);
  return root;
}

/** VRCNext's text input. */
export function textField(options: {
  readonly value: string;
  readonly placeholder?: string;
  readonly onCommit: (next: string) => void;
}): HTMLInputElement {
  const input = element('input', 'vrcn-edit-field');
  input.type = 'text';
  input.style.flex = '1';
  input.value = options.value;
  input.spellcheck = false;
  if (options.placeholder !== undefined) input.placeholder = options.placeholder;

  // Commit on blur or Enter, never per keystroke — this backs things like a daemon endpoint, and
  // re-probing on every character typed would be both noisy and wrong.
  input.addEventListener('change', () => { options.onCommit(input.value); });
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') input.blur();
  });
  return input;
}

/** VRCNext's select. */
export function dropdown(options: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: string;
  readonly onChange: (next: string) => void;
}): HTMLSelectElement {
  const select = element('select', 'vrcn-dropdown');
  for (const item of options.options) {
    const option = element('option', undefined, item.label);
    option.value = item.value;
    option.selected = item.value === options.selected;
    select.appendChild(option);
  }
  select.addEventListener('change', () => { options.onChange(select.value); });
  return select;
}

/** An empty-state line, matching the muted tone VRCNext uses for "nothing here yet". */
export function emptyState(text: string): HTMLElement {
  const node = element('div', 'set-desc', text);
  node.style.cssText = 'text-align:center;padding:18px 0;margin:0;';
  return node;
}
