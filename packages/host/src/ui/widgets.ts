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

import { element, iconSpan } from './dom.js';

/**
 * The column a tab's content lives in.
 *
 * VRCNext's settings tabs put their cards inside `.settings-content`, which supplies the padding,
 * the 16px gap between cards and the scroll container. Appending cards straight into a tab — which
 * is what these panels used to do — produces flush, edge-to-edge cards with no breathing room.
 */
export function panelLayout(): HTMLElement {
  return element('div', 'settings-content');
}

/** A titled card. Pass no title for a bare card, as VRCNext does for status strips. */
export function card(title?: string, icon?: string): HTMLElement {
  const root = element('div', 'vrcn-panel-card');
  if (title === undefined) return root;

  const header = element('div', 'vrcn-panel-card-header');
  if (icon !== undefined) header.appendChild(iconSpan(icon));
  header.appendChild(element('span', undefined, title));
  root.appendChild(header);
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
}): HTMLButtonElement {
  const node = element('button', 'vrcn-button');
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
