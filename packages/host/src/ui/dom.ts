/**
 * VRCNext DOM contract.
 *
 * Every selector and class name here was read out of the VRCNext frontend rather than guessed.
 * They are centralised so a VRCNext update that moves the markup breaks in one place with a
 * clear message, instead of silently rendering an unstyled panel.
 */

export const SELECTORS = {
  sidebar: '#sidebarEl',
  navButtons: '#sidebarEl .nav-btn[onclick]',
  tabs: '.tab',
  content: '.content',
  settingsTab: '#tab9',
} as const;

export const CLASSES = {
  navButton: 'nav-btn',
  navIcon: 'ni msi',
  navLabel: 'nl',
  navGroup: 'nav-group',
  tab: 'tab',
  tabActive: 'active',
  icon: 'msi',
  card: 'vrcn-panel-card',
  cardHeader: 'vrcn-panel-card-header',
  toggleRow: 'sf-toggle-row',
  toggle: 'toggle',
  toggleTrack: 'toggle-track',
  toggleKnob: 'toggle-knob',
} as const;

export class HostDomError extends Error {
  override readonly name = 'HostDomError';
}

export function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new HostDomError(
      `VRCNext element "${selector}" is missing. The plugin system may not support this VRCNext version.`,
    );
  }
  return element;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Material Symbols ligature span, matching VRCNext's own `.msi` usage. */
export function iconSpan(name: string, extraClass?: string): HTMLSpanElement {
  return element('span', extraClass === undefined ? CLASSES.icon : `${CLASSES.icon} ${extraClass}`, name);
}

/**
 * `showTab(i)` indexes into `document.querySelectorAll('.tab')`, so a tab's index is its
 * position among its siblings — not its element id.
 */
export function tabIndexOf(tab: Element): number {
  return [...document.querySelectorAll(SELECTORS.tabs)].indexOf(tab);
}

export function tabContainer(): HTMLElement {
  const tabs = document.querySelectorAll<HTMLElement>(SELECTORS.tabs);
  const last = tabs[tabs.length - 1];
  const parent = last?.parentElement;
  if (parent === null || parent === undefined) {
    throw new HostDomError('Could not find the VRCNext tab container.');
  }
  return parent;
}

/** Calls VRCNext's global `showTab`, which owns active-class bookkeeping across the whole shell. */
export function showTab(index: number): void {
  const fn = (globalThis as { showTab?: unknown }).showTab;
  if (typeof fn !== 'function') {
    throw new HostDomError('VRCNext’s showTab() is unavailable.');
  }
  (fn as (i: number) => void)(index);
}
