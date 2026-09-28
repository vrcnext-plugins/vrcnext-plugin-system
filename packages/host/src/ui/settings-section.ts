/**
 * Sections and dividers inside VRCNext's own Settings tab.
 *
 * VRCNext's settings page is a left-hand nav of `.settings-nav-item` buttons and a
 * `.settings-content` column of `[data-section=…]` blocks; `switchSettingsSection` shows the
 * blocks whose `data-section` matches and hides the rest, and its search walks every block's
 * text. This service adds nav items and dividers below VRCNext's own and files blocks under
 * them, so they behave exactly like VRCNext's sections: same switch, same search, same active
 * state. The host's Plugin System and Plugins sections and any plugin's own sections all come
 * from here; there is one implementation.
 *
 * The nav items carry VRCNext's `onclick="switchSettingsSection('…', this)"` attribute rather
 * than a listener, because VRCNext reads that attribute back to learn which section is active
 * after a search is cleared.
 */

import { CLASSES, SELECTORS, element, iconSpan, requireElement, showTab, tabIndexOf } from './dom.js';

/** The host's own section ids. */
export const SYSTEM_SECTION = 'plugin-system';
export const PLUGINS_SECTION = 'plugins';

/** Where VRCNext lands when the section on screen goes away. */
const FALLBACK_SECTION = 'general';

/** What a section id may contain: the plugin id, a dot, and the plugin's own id. */
const SECTION_ID = /^[a-z0-9._-]+$/;

/**
 * @throws {Error} naming the id when it is empty or has anything outside `[a-z0-9._-]`.
 */
export function requireSectionId(id: string): void {
  if (!SECTION_ID.test(id)) {
    throw new Error(`Settings section id "${id}" is invalid: use only lowercase letters, digits, ".", "_" and "-".`);
  }
}

type SwitchSection = (id: string, button: HTMLElement | null) => void;

function switchSection(): SwitchSection | undefined {
  const fn: unknown = (globalThis as { switchSettingsSection?: unknown }).switchSettingsSection;
  return typeof fn === 'function' ? (fn as SwitchSection) : undefined;
}

export interface SectionSpec {
  /** The `data-section` value. Must be unique across the page. */
  readonly sectionId: string;
  readonly label: string;
  readonly icon: string;
}

/** One live section. */
export interface SectionBinding {
  readonly navItem: HTMLElement;
  readonly sectionId: string;
  isActive(): boolean;
  /** Files a block under the section, hidden unless the section is the one on screen. */
  attach(block: HTMLElement): void;
  /** Opens VRCNext's Settings tab on this section, scrolled to `block` when given. */
  open(block?: HTMLElement): void;
  /** Removes the nav item and every attached block; falls back to General if it was active. */
  remove(): void;
}

export class SettingsNav {
  /** Adds a thin rule to the nav, matching the column's border. Remove it with `.remove()`. */
  addDivider(): HTMLElement {
    const divider = element('div');
    divider.style.cssText = 'height:1px;margin:6px 4px;background:rgba(255,255,255,.07);flex-shrink:0;';
    requireElement(SELECTORS.settingsNav).appendChild(divider);
    return divider;
  }

  /**
   * @throws {Error} when the id is anything but `[a-z0-9._-]`. It is written into an inline
   *   `onclick`, so nothing that could close the string literal may reach it.
   */
  addSection(spec: SectionSpec): SectionBinding {
    requireSectionId(spec.sectionId);
    const item = element('button', CLASSES.settingsNavItem);
    item.setAttribute('onclick', `switchSettingsSection('${spec.sectionId}', this)`);
    item.appendChild(iconSpan(spec.icon));
    item.appendChild(element('span', undefined, spec.label));
    requireElement(SELECTORS.settingsNav).appendChild(item);

    const blocks = new Set<HTMLElement>();
    const isActive = (): boolean => item.classList.contains(CLASSES.settingsNavActive);
    return {
      navItem: item,
      sectionId: spec.sectionId,
      isActive,
      attach(block: HTMLElement): void {
        block.dataset['section'] = spec.sectionId;
        if (!isActive()) block.style.display = 'none';
        requireElement(SELECTORS.settingsContent).appendChild(block);
        blocks.add(block);
      },
      open(block?: HTMLElement): void {
        showTab(tabIndexOf(requireElement(SELECTORS.settingsTab)));
        switchSection()?.(spec.sectionId, item);
        // Guarded: `scrollIntoView` is missing in a plain DOM, and a card that cannot be
        // scrolled to is still a card the section shows.
        if (typeof block?.scrollIntoView === 'function') block.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
      remove(): void {
        const wasActive = isActive();
        item.remove();
        for (const block of blocks) block.remove();
        blocks.clear();
        if (wasActive) switchSection()?.(FALLBACK_SECTION, null);
      },
    };
  }
}
