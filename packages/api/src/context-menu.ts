/**
 * Context-menu contributions.
 *
 * VRCNext builds its menus inside a module closure — `getMenuConfig` is not reachable from
 * outside — so plugin items are appended to the rendered menu rather than merged into its item
 * list. Each contributed button carries its own listener, leaving VRCNext's internal callback
 * array untouched.
 *
 * Item shape mirrors VRCNext's own (`icon`, `label`, `danger`, `checked`, submenus, `'sep'`
 * dividers) so contributions are visually indistinguishable from native entries.
 */

import type { IconName } from './ui.js';

export interface ContextMenuItem {
  readonly kind: 'item';
  readonly icon: IconName;
  readonly label: string;
  /** Renders in VRCNext's destructive style. */
  readonly danger?: boolean;
  /** Shows a check mark, for toggle-style entries. */
  readonly checked?: boolean;
  onSelect(): void | Promise<void>;
}

export interface ContextMenuSubmenu {
  readonly kind: 'submenu';
  readonly icon: IconName;
  readonly label: string;
  /** Resolved when the submenu opens, so entries can reflect current state. */
  items(): readonly ContextMenuEntry[] | Promise<readonly ContextMenuEntry[]>;
}

export interface ContextMenuDivider {
  readonly kind: 'divider';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSubmenu | ContextMenuDivider;

/** Describes the element the menu was opened on. */
export interface ContextMenuTarget {
  readonly element: HTMLElement;
  /** VRChat entity VRCNext associated with the element, when it could determine one. */
  readonly entity:
    | { readonly type: 'user' | 'avatar' | 'world' | 'group' | 'instance'; readonly id: string }
    | undefined;
}

/**
 * Returns entries to append, or an empty array to contribute nothing. Runs on every menu open,
 * so keep it cheap and synchronous where possible.
 */
export type ContextMenuProvider = (
  target: ContextMenuTarget,
) => readonly ContextMenuEntry[] | Promise<readonly ContextMenuEntry[]>;

export interface ContextMenuApi {
  /** Contributes to every VRCNext context menu. Filter inside the provider. */
  contribute(provider: ContextMenuProvider): () => void;

  /** Contributes only when the menu target matches a CSS selector. */
  contributeFor(selector: string, provider: ContextMenuProvider): () => void;

  /** Opens a standalone menu at viewport coordinates, using VRCNext's renderer. */
  open(x: number, y: number, entries: readonly ContextMenuEntry[]): void;
}
