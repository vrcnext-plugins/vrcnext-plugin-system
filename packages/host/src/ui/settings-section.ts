/**
 * A "Plugins" section inside VRCNext's own Settings tab.
 *
 * VRCNext's settings page is a left-hand nav of `.settings-nav-item` buttons and a
 * `.settings-content` column of `.vrcn-panel-card[data-section=…]` cards; `switchSettingsSection`
 * shows the cards whose `data-section` matches and hides the rest. A card appended anywhere else
 * lands outside that layout, full width under the columns. This module adds one nav item and
 * tags plugin cards with `data-section="plugins"`, so they behave like VRCNext's own.
 */

import { CLASSES, SELECTORS, element, iconSpan, requireElement, showTab, tabIndexOf } from './dom.js';

export const SECTION_ID = 'plugins';
const NAV_ATTR = 'data-vrcnext-plugin-host';

type SwitchSection = (id: string, button: HTMLElement | null) => void;

function switchSection(): SwitchSection | undefined {
  const fn: unknown = (globalThis as { switchSettingsSection?: unknown }).switchSettingsSection;
  return typeof fn === 'function' ? (fn as SwitchSection) : undefined;
}

export class SettingsSection {
  #navItem: HTMLElement | undefined;

  /** Adds the nav item once. Safe to call before any plugin card exists. */
  mount(): void {
    if (this.#navItem?.isConnected === true) return;
    const nav = requireElement(SELECTORS.settingsNav);
    const item = element('button', CLASSES.settingsNavItem);
    item.setAttribute(NAV_ATTR, 'settings-nav');
    item.appendChild(iconSpan('extension'));
    item.appendChild(element('span', undefined, 'Plugins'));
    item.addEventListener('click', () => { switchSection()?.(SECTION_ID, item); });
    nav.appendChild(item);
    this.#navItem = item;
  }

  unmount(): void {
    this.#navItem?.remove();
    this.#navItem = undefined;
  }

  /** Whether VRCNext currently shows the Plugins section. */
  #isActive(): boolean {
    return this.#navItem?.classList.contains(CLASSES.settingsNavActive) === true;
  }

  /** Places a plugin's card in the section, hidden unless the section is the one on screen. */
  attach(card: HTMLElement): void {
    this.mount();
    card.dataset['section'] = SECTION_ID;
    if (!this.#isActive()) card.style.display = 'none';
    requireElement(SELECTORS.settingsContent).appendChild(card);
  }

  /** Opens VRCNext's Settings tab on the Plugins section, scrolled to `card` when given. */
  open(card?: HTMLElement): void {
    this.mount();
    showTab(tabIndexOf(requireElement(SELECTORS.settingsTab)));
    switchSection()?.(SECTION_ID, this.#navItem ?? null);
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
