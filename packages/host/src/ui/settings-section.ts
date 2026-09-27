/**
 * The host's sections inside VRCNext's own Settings tab.
 *
 * VRCNext's settings page is a left-hand nav of `.settings-nav-item` buttons and a
 * `.settings-content` column of `[data-section=…]` blocks; `switchSettingsSection` shows the
 * blocks whose `data-section` matches and hides the rest, and its search walks every block's
 * text. This module adds a divider and two nav items below VRCNext's own — **Plugin System**
 * (bridge, status, logs) and **Plugins** (install and manage, then every plugin's settings
 * card) — and files the host's blocks and the plugins' cards under them, so they behave exactly
 * like VRCNext's sections: same switch, same search, same active state.
 *
 * The nav items carry VRCNext's `onclick="switchSettingsSection('…', this)"` attribute rather
 * than a listener, because VRCNext reads that attribute back to learn which section is active
 * after a search is cleared.
 */

import { CLASSES, SELECTORS, element, iconSpan, requireElement, showTab, tabIndexOf } from './dom.js';

export const SYSTEM_SECTION = 'plugin-system';
export const PLUGINS_SECTION = 'plugins';
export type SectionId = typeof SYSTEM_SECTION | typeof PLUGINS_SECTION;

const NAV_ATTR = 'data-vrcnext-plugin-host';

interface SectionSpec {
  readonly id: SectionId;
  readonly label: string;
  readonly icon: string;
}

/** In nav order. */
export const SECTIONS: readonly SectionSpec[] = [
  { id: SYSTEM_SECTION, label: 'Plugin System', icon: 'tune' },
  { id: PLUGINS_SECTION, label: 'Plugins', icon: 'extension' },
];

type SwitchSection = (id: string, button: HTMLElement | null) => void;

function switchSection(): SwitchSection | undefined {
  const fn: unknown = (globalThis as { switchSettingsSection?: unknown }).switchSettingsSection;
  return typeof fn === 'function' ? (fn as SwitchSection) : undefined;
}

export class SettingsSections {
  readonly #navItems = new Map<SectionId, HTMLElement>();
  #divider: HTMLElement | undefined;

  /** Adds the divider and the nav items once. Safe to call before any content exists. */
  mount(): void {
    if (this.#divider?.isConnected === true) return;
    const nav = requireElement(SELECTORS.settingsNav);

    const divider = element('div');
    divider.setAttribute(NAV_ATTR, 'settings-divider');
    // VRCNext's nav has no divider of its own; this matches the column's border.
    divider.style.cssText = 'height:1px;margin:6px 4px;background:rgba(255,255,255,.07);flex-shrink:0;';
    nav.appendChild(divider);
    this.#divider = divider;

    for (const spec of SECTIONS) {
      const item = element('button', CLASSES.settingsNavItem);
      item.setAttribute(NAV_ATTR, `settings-nav-${spec.id}`);
      item.setAttribute('onclick', `switchSettingsSection('${spec.id}', this)`);
      item.appendChild(iconSpan(spec.icon));
      item.appendChild(element('span', undefined, spec.label));
      nav.appendChild(item);
      this.#navItems.set(spec.id, item);
    }
  }

  unmount(): void {
    this.#divider?.remove();
    this.#divider = undefined;
    for (const item of this.#navItems.values()) item.remove();
    this.#navItems.clear();
  }

  /** Whether VRCNext currently shows `section`. */
  isActive(section: SectionId): boolean {
    return this.#navItems.get(section)?.classList.contains(CLASSES.settingsNavActive) === true;
  }

  /** Files `block` under `section`, hidden unless that section is the one on screen. */
  attach(section: SectionId, block: HTMLElement): void {
    this.mount();
    block.dataset['section'] = section;
    if (!this.isActive(section)) block.style.display = 'none';
    requireElement(SELECTORS.settingsContent).appendChild(block);
  }

  /** Opens VRCNext's Settings tab on `section`, scrolled to `block` when given. */
  open(section: SectionId, block?: HTMLElement): void {
    this.mount();
    showTab(tabIndexOf(requireElement(SELECTORS.settingsTab)));
    switchSection()?.(section, this.#navItems.get(section) ?? null);
    block?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
