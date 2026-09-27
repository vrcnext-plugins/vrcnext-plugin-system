/**
 * Declarative builders for VRCNext-native UI.
 *
 * `ctx.ui.kit` exists so a plugin does not have to know VRCNext's class names, or assemble
 * `document.createElement` trees by hand, to produce a panel that looks like it shipped with the
 * app. Describe the shape; the kit emits VRCNext's own markup.
 *
 * ```ts
 * const k = ctx.ui.kit;
 * container.append(
 *   k.layout(
 *     k.grid([
 *       k.card({ title: 'Status', icon: 'info', children: [
 *         k.row({ label: 'Connection', value: k.badge('ok', 'Online') }),
 *         k.row({ label: 'Events seen', value: String(count) }),
 *       ]}),
 *       k.card({ title: 'Controls', icon: 'tune', children: [
 *         k.toggleRow({ label: 'Announce joins', value: true, onChange: setAnnounce }),
 *         k.buttonRow(k.button({ label: 'Reset', icon: 'refresh', onClick: reset })),
 *       ]}),
 *     ]),
 *   ),
 * );
 * ```
 *
 * Everything returns a plain DOM node, so anything the kit does not cover stays available — keep
 * a reference and mutate it, or drop your own element into a `children` array.
 */

import type { IconName } from './ui.js';

/**
 * Anything acceptable as a child.
 *
 * `false`, `null` and `undefined` are dropped, so a conditional child needs no ceremony:
 * `children: [row, isAdmin && adminRow]`.
 */
export type UiChild = Node | string | false | null | undefined;

/** Semantic colours from VRCNext's own badge set. */
export type UiBadgeTone = 'ok' | 'warn' | 'warning' | 'err' | 'accent' | 'cyan' | 'neutral';

export interface UiCardOptions {
  /** Card heading. Omit for a card with no header. */
  readonly title?: string;
  /** Leading icon for the heading. Must be a glyph VRCNext ships — see {@link IconName}. */
  readonly icon?: IconName;
  readonly children?: readonly UiChild[];
  /**
   * Width inside a {@link UiKit.grid}. Ignored elsewhere.
   *
   * `'full'` spans every column there currently is, and is what you want for a card that should
   * own its row. A **number** is a fixed span, which overflows if the grid has since collapsed to
   * fewer columns than that on a narrow window — prefer `'full'` unless you control the width.
   */
  readonly span?: number | 'full';
}

/** The dot's colour: green, yellow, or grey. */
export type UiStatusTone = 'online' | 'warn' | 'offline';

export interface UiStatusCardOptions {
  /** Drives the dot's colour. */
  readonly tone: UiStatusTone;
  readonly label: string;
  /** Usually a {@link UiKit.button}, shown on the right. */
  readonly action?: Node;
}

export interface UiRowOptions {
  readonly label: string;
  /** Muted second line under the label. */
  readonly detail?: string;
  /** Right-hand content. A string is rendered as muted value text. */
  readonly value?: UiChild;
  /** Put the content on its own line under the label, full width. For text areas and lists. */
  readonly stacked?: boolean;
}

export interface UiToggleRowOptions {
  readonly label: string;
  readonly detail?: string;
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
}

export interface UiButtonOptions {
  readonly label: string;
  readonly icon?: IconName;
  readonly onClick: () => void;
  /** Renders VRCNext's pressed state. */
  readonly active?: boolean;
  readonly disabled?: boolean;
  /** Compact circular variant. Pair with `icon` and an empty `label`. */
  readonly round?: boolean;
}

export interface UiTextFieldOptions {
  readonly value: string;
  readonly placeholder?: string;
  /** Fires on blur and on Enter — never per keystroke. */
  readonly onCommit: (next: string) => void;
}

export interface UiTextAreaOptions {
  readonly value: string;
  readonly placeholder?: string;
  /** Visible lines before it scrolls. Default 4; the user can drag it taller. */
  readonly rows?: number;
  /** Fires on blur — never per keystroke. */
  readonly onCommit: (next: string) => void;
}

export interface UiDropdownOptions {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: string;
  readonly onChange: (next: string) => void;
}

export interface UiSliderOptions {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** `'any'` snaps to the markers only. */
  readonly step?: number | 'any';
  /** Labelled tick marks under the track. */
  readonly markers?: readonly number[];
  /** The thumb rests only on the markers. */
  readonly snapToMarkers?: boolean;
  /** Shown after the value readout, e.g. `s` or `%`. */
  readonly unit?: string;
  readonly disabled?: boolean;
  /** Fires while dragging; `onChange` fires on release. */
  readonly onInput?: (next: number) => void;
  readonly onChange: (next: number) => void;
}

export interface UiChipsOptions {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: readonly string[];
  /** Several may be pressed at once. */
  readonly multiple: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: readonly string[]) => void;
}

export interface UiTypedFieldOptions {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (next: string) => void;
}

export interface UiListItemOptions {
  readonly title: string;
  readonly subtitle?: string;
  /** Round picture on the left; a letter when empty. */
  readonly imageUrl?: string;
  /** Small green text on the right, like VRCNext's "Friend". */
  readonly badge?: string;
  readonly onClick?: () => void;
}

export interface UiGridOptions {
  /**
   * Minimum column width in pixels before the grid reflows to fewer columns. Default 280.
   *
   * The grid is responsive: it fits as many columns of at least this width as the panel allows,
   * so the same code works in a narrow sidebar-heavy window and a maximised one.
   */
  readonly min?: number;
}

export interface UiStatOptions {
  readonly label: string;
  readonly value: string;
  /** Optional tone for the value, for at-a-glance good/bad. */
  readonly tone?: UiBadgeTone;
}

export interface UiKit {
  /** The padded, gapped, scrolling column VRCNext gives its own settings tabs. */
  layout(...children: readonly UiChild[]): HTMLElement;

  /**
   * A responsive grid of cards — the default choice when a panel has more than one card.
   *
   * Full-width cards stacked vertically waste most of a wide window. This fits as many columns as
   * the space allows and reflows when it narrows.
   */
  grid(children: readonly UiChild[], options?: UiGridOptions): HTMLElement;

  /** Exactly two cards side by side, each taking half the width. */
  pair(first: UiChild, second: UiChild): HTMLElement;

  card(options: UiCardOptions): HTMLElement;

  /** The compact dot-and-label strip VRCNext puts at the top of its tool tabs. */
  statusCard(options: UiStatusCardOptions): HTMLElement;

  /** A labelled group of rows inside a card: an uppercase label followed by its children. */
  section(label: string, children: readonly UiChild[]): DocumentFragment;

  row(options: UiRowOptions): HTMLElement;
  toggleRow(options: UiToggleRowOptions): HTMLElement;

  /** A horizontal strip of controls, spaced like VRCNext's own button rows. */
  buttonRow(...children: readonly UiChild[]): HTMLElement;

  button(options: UiButtonOptions): HTMLButtonElement;
  textField(options: UiTextFieldOptions): HTMLInputElement;
  /** A multi-line field. Pair it with `row({ stacked: true })` so it gets the full width. */
  textArea(options: UiTextAreaOptions): HTMLTextAreaElement;
  dropdown(options: UiDropdownOptions): HTMLSelectElement;

  /** VRCNext's slider with a value readout and optional labelled markers. */
  slider(options: UiSliderOptions): HTMLElement;
  /** Toggle buttons; the pressed ones are the chosen values. */
  chips(options: UiChipsOptions): HTMLElement;
  /** A time-of-day field, `HH:MM`. */
  timeField(options: UiTypedFieldOptions): HTMLInputElement;
  /** A colour swatch that opens the picker, `#rrggbb`. */
  colorField(options: UiTypedFieldOptions): HTMLInputElement;
  /** VRCNext's compact profile row: picture, name, muted line. For users, worlds, avatars, groups. */
  listItem(options: UiListItemOptions): HTMLElement;

  /** A small coloured pill. */
  badge(tone: UiBadgeTone, text: string): HTMLElement;

  /** A big number with a caption, for dashboard-style summaries. */
  stat(options: UiStatOptions): HTMLElement;

  /** Body copy under a card header. */
  description(text: string): HTMLElement;

  /** An uppercase label that groups rows inside a card. */
  sectionLabel(text: string): HTMLElement;

  /** Muted right-hand value text. Set `.textContent` later to update it in place. */
  valueText(text: string): HTMLElement;

  /** Centred muted line for "nothing here yet". */
  emptyState(text: string): HTMLElement;

  /**
   * Replace a node's children, flattening and dropping `false`/`null`/`undefined`.
   *
   * The intended way to refresh a panel: keep the card, rebuild its contents.
   */
  setChildren(parent: Node, children: readonly UiChild[]): void;
}
