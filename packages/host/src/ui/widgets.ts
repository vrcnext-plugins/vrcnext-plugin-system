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
  --vrcnx-grid-gap: 16px;
  /* Columns are at least --vrcnx-grid-min wide, and never more than --vrcnx-grid-max of them. */
  grid-template-columns: repeat(
    auto-fit,
    minmax(
      max(
        var(--vrcnx-grid-min, 280px),
        calc((100% - (var(--vrcnx-grid-max, 99) - 1) * var(--vrcnx-grid-gap)) / var(--vrcnx-grid-max, 99))
      ),
      1fr
    )
  );
  gap: var(--vrcnx-grid-gap);
  align-items: start;
  grid-auto-flow: row dense;
}
.vrcnx-grid > .vrcnx-full { grid-column: 1 / -1; }
.settings-content .settings-content { padding: 0; overflow: visible; }
.sf-dot.vrcnx-dot-warn { background: var(--warn); }
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
/* VRCNext draws its font-size slider's track with .fs-ticks, which is that feature's dashed
   ten-step ruler. A general slider wants a plain track with the chosen part filled. */
.vrcnx-slider-track {
  position: absolute; left: 7px; right: 7px; top: 50%; height: 4px;
  transform: translateY(-50%); border-radius: 2px; background: var(--brd); pointer-events: none;
}
.vrcnx-slider-fill { position: absolute; left: 0; top: 0; height: 100%; border-radius: 2px; background: var(--accent); }
.vrcnx-slider-tick {
  position: absolute; top: -3px; width: 1px; height: 10px; background: var(--brd);
  transform: translateX(-50%);
}
.vrcnx-slider-marks { position: relative; height: 14px; margin: 0 7px; }
.vrcnx-slider-mark {
  position: absolute; transform: translateX(-50%); top: 0;
  font-size: calc(10px + var(--fs-off, 0px)); color: var(--tx2); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.vrcnx-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; }
.vrcnx-chips-left { justify-content: flex-start; }
.vrcnx-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px;
  border: 1px solid var(--brd); border-radius: 999px; background: var(--bg-input);
  font-size: calc(11px + var(--fs-off, 0px)); color: var(--tx1); max-width: 100%;
}
.vrcnx-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vrcnx-chip-x {
  border: 0; background: transparent; color: var(--tx2); cursor: pointer; line-height: 1;
  padding: 2px; border-radius: 999px; display: inline-flex;
}
.vrcnx-chip-x:hover { color: var(--err); background: var(--bg-hover); }
.vrcnx-chip-x .msi { font-size: 14px; }
.vrcnx-plugin-list { display: flex; flex-direction: column; }
.vrcnx-plugin-row { border-top: 1px solid var(--brd); }
.vrcnx-plugin-row:first-child { border-top: 0; }
.vrcnx-plugin-summary {
  display: flex; align-items: center; gap: 10px; padding: 10px 0; cursor: pointer;
  list-style: none;
}
.vrcnx-plugin-summary::-webkit-details-marker { display: none; }
.vrcnx-plugin-summary > .msi { color: var(--tx2); transition: transform .12s; }
.vrcnx-plugin-row[open] > .vrcnx-plugin-summary > .msi { color: var(--accent); }
.vrcnx-plugin-text { flex: 1 1 auto; min-width: 0; }
.vrcnx-plugin-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--tx0); }
.vrcnx-plugin-blurb {
  margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vrcnx-plugin-row[open] .vrcnx-plugin-blurb { white-space: normal; }
.vrcnx-plugin-body { padding: 0 0 12px 30px; display: flex; flex-direction: column; gap: 6px; }
.vrcnx-plugin-body .sf-toggle-row { padding: 6px 0; }
.vrcnx-changelog summary { cursor: pointer; }
.vrcnx-changelog pre {
  white-space: pre-wrap; word-break: break-word; margin: 4px 0 0;
  font-size: calc(11px + var(--fs-off, 0px)); color: var(--tx2);
  max-height: 200px; overflow: auto;
}
.vrcnx-error { color: var(--err); font-size: calc(11px + var(--fs-off, 0px)); margin: 2px 0 0; }
.vrcnx-nested { border-left: 2px solid var(--brd); padding-left: 12px; margin: 4px 0; }
.vrcnx-list-item { border: 1px solid var(--brd); border-radius: 8px; padding: 4px 10px 8px; margin: 8px 0; }
.vrcnx-list-head { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.vrcnx-list-title { flex: 1 1 auto; font-weight: 600; color: var(--tx0); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vrcnx-pick-list { max-height: 50vh; overflow: auto; border: 1px solid var(--brd); border-radius: 8px; margin-top: 8px; }
.vrcnx-pick-list .fd-profile-item-small { cursor: pointer; }
.vrcnx-pick-list .fd-profile-item-small.vrcnx-picked { background: var(--bg-hover); }
.vrcnx-pick-list .fd-profile-item-small.vrcnx-picked .fd-pi-sm-name::after { content: 'check'; font-family: 'Material Symbols Rounded'; margin-left: auto; color: var(--accent); }
.vrcnx-picked-list { display: flex; flex-direction: column; gap: 2px; min-width: 220px; max-width: 100%; }
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
export function grid(children: readonly UiChild[], min = 280, maxColumns?: number): HTMLElement {
  ensureKitStyles();
  const root = element('div', 'vrcnx-grid');
  root.style.setProperty('--vrcnx-grid-min', `${String(min)}px`);
  if (maxColumns !== undefined) root.style.setProperty('--vrcnx-grid-max', String(maxColumns));
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
  // `warning` maps to VRCNext's `.vrcn-badge.warn` class (yellow).
  const cls = tone === 'neutral' ? 'hidden' : tone === 'warning' ? 'warn' : tone;
  return element('span', `vrcn-badge ${cls}`, text);
}

/** A big number with a caption. */
export function stat(label: string, text: string, tone?: UiBadgeTone): HTMLElement {
  ensureKitStyles();
  const root = element('div', 'vrcnx-stat');
  const number = element('div', 'vrcnx-stat-value', text);
  if (tone === 'ok' || tone === 'warn' || tone === 'warning' || tone === 'err') {
    const varName = tone === 'warning' ? 'warn' : tone;
    number.style.color = `var(--${varName})`;
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
/** The three colours a status dot can be. VRCNext's stylesheet only knows the first and last. */
export type StatusTone = 'online' | 'warn' | 'offline';

export function statusCard(options: {
  readonly tone: StatusTone;
  readonly label: string;
  readonly action?: HTMLElement;
}): HTMLElement {
  ensureKitStyles();
  const root = element('div', 'vrcn-panel-card status');
  const strip = element('div', 'sf-status-row');

  const status = element('div', 'sf-status');
  const dotClass = options.tone === 'warn' ? 'offline vrcnx-dot-warn' : options.tone;
  status.appendChild(element('span', `sf-dot ${dotClass}`));
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
export function row(
  label: string | Node,
  control?: Node,
  detail?: string,
  options: { readonly stacked?: boolean } = {},
): HTMLElement {
  const root = element('div', 'sf-toggle-row');
  // VRCNext's row has no gap of its own: a wide control would sit flush against the label.
  root.style.gap = '16px';
  if (options.stacked === true) {
    root.style.flexDirection = 'column';
    root.style.alignItems = 'stretch';
    root.style.gap = '8px';
  }

  const renderLabel = (): Node => {
    const node = typeof label === 'string' ? element('span', undefined, label) : label;
    if (node instanceof HTMLElement) node.style.flex = '1 1 auto';
    return node;
  };

  if (detail === undefined) {
    root.appendChild(renderLabel());
  } else {
    // VRCNext's two-line variant: the label with a muted explanation stacked under it.
    //
    // It spells this `.sf-desc` in settings.html, but that class has no CSS rule anywhere in the
    // frontend — it renders at full size there too. `.set-desc` is the real muted style; its
    // bottom margin is the only thing that has to go, since this one sits inside a row.
    const stack = element('div');
    stack.style.cssText = 'min-width:0;flex:1 1 auto;';
    stack.appendChild(renderLabel());

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
  // A bounded width: in a row the label keeps the room, in a control strip it still shrinks.
  // Width, never flex-basis: in a column-direction parent a basis would set the height.
  input.style.cssText = 'width:320px;max-width:100%;min-width:0;';
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

/**
 * A multi-line `.vrcn-edit-field`, for templates and lists. Commits on blur, like the text
 * field; a template being typed should not be applied per keystroke.
 */
export function textArea(options: {
  readonly value: string;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly onCommit: (next: string) => void;
}): HTMLTextAreaElement {
  const area = element('textarea', 'vrcn-edit-field');
  area.rows = options.rows ?? 4;
  area.style.cssText =
    'width:100%;box-sizing:border-box;height:auto;min-height:72px;padding:8px 10px;resize:vertical;' +
    'line-height:1.5;font-family:ui-monospace,monospace;white-space:pre;';
  area.value = options.value;
  area.spellcheck = false;
  if (options.placeholder !== undefined) area.placeholder = options.placeholder;
  area.addEventListener('change', () => { options.onCommit(area.value); });
  return area;
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

/** A slider that can also be moved from outside, by whoever owns the value. */
export type SliderElement = HTMLElement & { setValue(next: number): void };

/** The `<datalist>` a range input points at, so the browser draws its own tick marks too. */
function markerList(input: HTMLInputElement, markers: readonly number[]): HTMLElement {
  const list = element('datalist');
  list.id = `vrcnx-marks-${String(Math.random()).slice(2)}`;
  for (const mark of markers) {
    const option = element('option');
    option.value = String(mark);
    list.appendChild(option);
  }
  input.setAttribute('list', list.id);
  return list;
}

/** The numbers under the track, each over its tick. */
function markerLabels(markers: readonly number[], percent: (n: number) => number): HTMLElement {
  const marks = element('div', 'vrcnx-slider-marks');
  for (const mark of markers) {
    const label = element('span', 'vrcnx-slider-mark', String(mark));
    label.style.left = `${String(percent(mark))}%`;
    marks.appendChild(label);
  }
  return marks;
}

/** VRCNext's slider (`.fs-slider`), with a value readout, a filled track and labelled markers. */
export function slider(options: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** `'any'` lets the thumb rest between markers only where the datalist has one. */
  readonly step?: number | 'any';
  readonly markers?: readonly number[];
  /** The thumb rests only on markers, as Equicord's marker sliders do. */
  readonly snapToMarkers?: boolean;
  readonly unit?: string;
  readonly disabled?: boolean;
  /** Fires while dragging. */
  readonly onInput?: (next: number) => void;
  /** Fires when the thumb is released. */
  readonly onChange: (next: number) => void;
}): SliderElement {
  ensureKitStyles();
  const block = element('div', 'fs-slider-block');
  block.style.cssText = 'width:320px;max-width:100%;min-width:0;';

  const head = element('div', 'fs-slider-head');
  head.style.justifyContent = 'flex-end';
  const readout = element('span', 'fs-slider-val');
  head.appendChild(readout);
  block.appendChild(head);

  const span = options.max - options.min || 1;
  const percent = (n: number): number => Math.min(100, Math.max(0, ((n - options.min) / span) * 100));

  const wrap = element('div', 'fs-slider-wrap');
  const track = element('div', 'vrcnx-slider-track');
  const fill = element('div', 'vrcnx-slider-fill');
  track.appendChild(fill);
  const markers = options.markers ?? [];
  for (const mark of markers) {
    const tick = element('div', 'vrcnx-slider-tick');
    tick.style.left = `${String(percent(mark))}%`;
    track.appendChild(tick);
  }
  wrap.appendChild(track);

  const input = element('input', 'fs-slider');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step ?? 1);
  input.value = String(options.value);
  if (options.disabled === true) input.disabled = true;
  if (markers.length > 0) wrap.appendChild(markerList(input, markers));
  wrap.appendChild(input);
  block.appendChild(wrap);
  if (markers.length > 0) block.appendChild(markerLabels(markers, percent));

  const unit = options.unit ?? '';
  const paint = (n: number): void => {
    readout.textContent = `${String(n)}${unit}`;
    fill.style.width = `${String(percent(n))}%`;
  };
  paint(options.value);

  // Snapping is done here rather than with `step`, because markers are rarely evenly spaced
  // and a `list` attribute alone does not make a range input stop on its ticks.
  const snap = (n: number): number => {
    if (options.snapToMarkers !== true || markers.length === 0) return n;
    return markers.reduce((best, m) => (Math.abs(m - n) < Math.abs(best - n) ? m : best));
  };

  input.addEventListener('input', () => {
    const n = snap(Number(input.value));
    paint(n);
    options.onInput?.(n);
  });
  input.addEventListener('change', () => {
    const n = snap(Number(input.value));
    input.value = String(n);
    paint(n);
    options.onChange(n);
  });

  // A write from elsewhere sets the value and repaints; assigning `input.value` alone would
  // leave the readout and the filled track behind, and a synthetic event would be a lie.
  return Object.assign(block, {
    setValue(next: number): void {
      input.value = String(next);
      paint(next);
    },
  });
}

/** A row of toggle buttons; the pressed ones are the chosen values. */
export function chips(options: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: readonly string[];
  readonly multiple: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: readonly string[]) => void;
}): HTMLElement {
  ensureKitStyles();
  const root = element('div', 'vrcnx-chips');
  let chosen = [...options.selected];
  const buttons = new Map<string, HTMLButtonElement>();
  const paint = (): void => {
    for (const [value, node] of buttons) node.classList.toggle('active', chosen.includes(value));
  };
  for (const item of options.options) {
    const node = button({
      label: item.label,
      onClick: () => {
        if (options.multiple) {
          chosen = chosen.includes(item.value) ? chosen.filter((v) => v !== item.value) : [...chosen, item.value];
          chosen = options.options.map((o) => o.value).filter((v) => chosen.includes(v));
        } else {
          chosen = [item.value];
        }
        paint();
        options.onChange(chosen);
      },
    });
    if (options.disabled === true) node.disabled = true;
    buttons.set(item.value, node);
    root.appendChild(node);
  }
  paint();
  return root;
}

/** A small pill with a remove button, for a value the user can take back. */
export function chip(text: string, onRemove: () => void): HTMLElement {
  ensureKitStyles();
  const root = element('span', 'vrcnx-chip');
  const label = element('span', 'vrcnx-chip-text', text);
  label.title = text;
  const remove = element('button', 'vrcnx-chip-x');
  remove.type = 'button';
  remove.title = `Forget ${text}`;
  remove.appendChild(iconSpan('close'));
  remove.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  });
  root.append(label, remove);
  return root;
}

/** A native input styled as VRCNext's edit field; `type` is `time`, `color`, `url`, `password`, … */
export function typedField(type: string, options: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (next: string) => void;
}): HTMLInputElement {
  const input = element('input', 'vrcn-edit-field');
  input.type = type;
  input.value = options.value;
  if (options.disabled === true) input.disabled = true;
  if (type === 'color') {
    input.style.cssText = 'width:44px;height:28px;padding:2px;border-radius:6px;cursor:pointer;';
  } else {
    input.style.cssText = 'width:200px;max-width:100%;min-width:0;';
  }
  input.addEventListener('change', () => { options.onChange(input.value); });
  return input;
}

/** VRCNext's compact profile row (`.fd-profile-item-small`): a round picture, a name, a muted line. */
export function listItem(options: {
  readonly title: string;
  readonly subtitle?: string;
  readonly imageUrl?: string;
  readonly badge?: string;
  readonly onClick?: () => void;
}): HTMLElement {
  const root = element('div', 'fd-profile-item-small');
  const picture = element('div', 'fd-pi-sm-av');
  if (options.imageUrl !== undefined && options.imageUrl !== '') {
    picture.style.backgroundImage = `url("${options.imageUrl.replace(/"/g, '%22')}")`;
  } else {
    picture.classList.add('fd-pi-sm-av-letter');
    picture.textContent = (options.title[0] ?? '?').toUpperCase();
  }
  const info = element('div', 'fd-pi-sm-info');
  info.style.minWidth = '0';
  const name = element('div', 'fd-pi-sm-name', options.title);
  if (options.badge !== undefined) name.appendChild(element('span', 'fd-pi-sm-badge', options.badge));
  info.appendChild(name);
  if (options.subtitle !== undefined && options.subtitle !== '') info.appendChild(element('div', 'fd-pi-sm-sub', options.subtitle));
  root.append(picture, info);
  if (options.onClick !== undefined) {
    root.style.cursor = 'pointer';
    root.addEventListener('click', options.onClick);
  }
  return root;
}

/** A red line under a control. Hidden while empty. */
export function errorLine(): HTMLElement & { show(message: string | undefined): void } {
  ensureKitStyles();
  const node = element('div', 'vrcnx-error');
  node.style.display = 'none';
  return Object.assign(node, {
    show(message: string | undefined): void {
      node.textContent = message ?? '';
      node.style.display = message === undefined ? 'none' : '';
    },
  });
}

/** An empty-state line, matching the muted tone VRCNext uses for "nothing here yet". */
export function emptyState(text: string): HTMLElement {
  const node = element('div', 'set-desc', text);
  node.style.cssText = 'text-align:center;padding:18px 0;margin:0;';
  return node;
}
