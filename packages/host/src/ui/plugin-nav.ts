/**
 * The "Plugins" navigation group, mirrored in the sidebar and the top menu bar.
 *
 * One {@link NavEntry} list drives both surfaces — only the markup builders differ, because
 * VRCNext's sidebar and taskbar use unrelated DOM. Activation, lazy rendering and tab ownership
 * are shared.
 *
 * Two VRCNext behaviours force the shape of this code:
 *
 * - `navRender()` does `navEl.innerHTML = ''`, so the sidebar group is re-appended by a
 *   `MutationObserver` rather than assumed to persist.
 * - The taskbar binds its menu listeners **once at init** with `querySelectorAll`, so a menu
 *   added later receives none. This mounts its own handlers that mirror `activateMenu`.
 */

import type { Disposable, IconName } from '@vrcnext/plugin-api';

import { CLASSES, element, iconSpan, requireElement, SELECTORS, showTab, tabContainer, tabIndexOf } from './dom.js';

const HOST_ATTR = 'data-vrcnext-plugin-host';

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  render(container: HTMLElement): void;
}

export interface PluginNavOptions {
  readonly entries: readonly NavEntry[];
  readonly groupId: string;
  readonly groupLabel: string;
  readonly groupIcon: IconName;
  readonly onError: (error: unknown, entry: NavEntry) => void;
}

export class PluginNav implements Disposable {
  readonly #options: PluginNavOptions;
  readonly #tabs = new Map<string, HTMLElement>();
  readonly #rendered = new Set<string>();
  readonly #disposers: (() => void)[] = [];

  constructor(options: PluginNavOptions) {
    this.#options = options;
  }

  mount(): void {
    this.#createTabs();
    this.#mountSidebar();
    this.#mountTaskbar();
  }

  /** One `.tab` per entry, appended beside VRCNext's own. */
  #createTabs(): void {
    const container = tabContainer();
    for (const entry of this.#options.entries) {
      const tab = element('div', CLASSES.tab);
      tab.setAttribute(HOST_ATTR, entry.id);
      container.appendChild(tab);
      this.#tabs.set(entry.id, tab);
      this.#disposers.push(() => { tab.remove(); });
    }
  }

  /** Shared by both surfaces: render once, then hand off to VRCNext's own tab switcher. */
  #activate(entry: NavEntry): void {
    const tab = this.#tabs.get(entry.id);
    if (tab === undefined) return;

    if (!this.#rendered.has(entry.id)) {
      this.#rendered.add(entry.id);
      try {
        entry.render(tab);
      } catch (error) {
        this.#rendered.delete(entry.id);
        this.#options.onError(error, entry);
        return;
      }
    }
    showTab(tabIndexOf(tab));
  }

  // Sidebar

  #mountSidebar(): void {
    const nav = requireElement(SELECTORS.navList);
    const separator = PluginNav.#buildSidebarSeparator(this.#options.groupLabel);
    const group = this.#buildSidebarGroup();

    const attach = (): void => {
      if (!nav.contains(separator)) nav.appendChild(separator);
      if (!nav.contains(group)) nav.appendChild(group);
    };
    attach();

    // navRender() clears the whole list whenever the nav editor saves or the layout changes.
    const observer = new MutationObserver(attach);
    observer.observe(nav, { childList: true });

    this.#disposers.push(() => {
      observer.disconnect();
      separator.remove();
      group.remove();
    });
  }

  static #buildSidebarSeparator(label: string): HTMLElement {
    const separator = element('div', 'nav-sep');
    separator.setAttribute(HOST_ATTR, 'sep');
    separator.appendChild(element('span', 'nav-sep-label nl', label));
    return separator;
  }

  #buildSidebarGroup(): HTMLElement {
    const { groupId, groupLabel, groupIcon, entries } = this.#options;

    const group = element('div', CLASSES.navGroup);
    group.id = groupId;
    group.dataset['groupId'] = groupId;
    group.setAttribute(HOST_ATTR, 'group');

    const header = element('button', `${CLASSES.navButton} nav-group-btn`);
    header.appendChild(iconSpan(groupIcon, 'ni'));
    header.appendChild(element('span', CLASSES.navLabel, groupLabel));
    header.appendChild(iconSpan('expand_more', 'nav-group-arrow nl'));
    // VRCNext's toggleNavGroup() resolves folders from its saved layout, where this group does
    // not exist — in modern-folder mode it would open a popout and find nothing. Own the toggle.
    header.addEventListener('click', () => { group.classList.toggle('collapsed'); });
    group.appendChild(header);

    const items = element('div', 'nav-group-items');
    for (const entry of entries) {
      items.appendChild(this.#buildSidebarItem(entry));
    }
    group.appendChild(items);
    return group;
  }

  #buildSidebarItem(entry: NavEntry): HTMLElement {
    const button = element('button', `${CLASSES.navButton} nav-sub`);
    button.setAttribute(HOST_ATTR, entry.id);
    button.appendChild(iconSpan(entry.icon, 'ni'));
    button.appendChild(element('span', CLASSES.navLabel, entry.label));
    button.addEventListener('click', () => { this.#activate(entry); });
    return button;
  }

  // Taskbar

  #mountTaskbar(): void {
    const menus = requireElement(SELECTORS.taskbarMenus);
    const separator = element('div', 'tb-sep');
    separator.setAttribute(HOST_ATTR, 'sep');
    const menu = this.#buildTaskbarMenu();

    const attach = (): void => {
      if (!menus.contains(separator)) menus.appendChild(separator);
      if (!menus.contains(menu)) menus.appendChild(menu);
    };
    attach();

    const observer = new MutationObserver(attach);
    observer.observe(menus, { childList: true });

    const onOutside = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && menu.contains(target)) return;
      menu.classList.remove('open');
    };
    document.addEventListener('mousedown', onOutside, true);

    this.#disposers.push(() => {
      observer.disconnect();
      document.removeEventListener('mousedown', onOutside, true);
      separator.remove();
      menu.remove();
    });
  }

  #buildTaskbarMenu(): HTMLElement {
    const { groupLabel, entries } = this.#options;

    const menu = element('div', 'tb-menu-item');
    menu.setAttribute(HOST_ATTR, 'menu');
    menu.appendChild(element('span', undefined, groupLabel));

    const dropdown = element('div', 'tb-dropdown');
    for (const entry of entries) {
      const item = element('div', 'tb-dd-item');
      item.setAttribute(HOST_ATTR, entry.id);
      item.appendChild(iconSpan(entry.icon));
      item.appendChild(element('span', undefined, entry.label));
      item.addEventListener('click', () => {
        menu.classList.remove('open');
        this.#activate(entry);
      });
      dropdown.appendChild(item);
    }
    menu.appendChild(dropdown);

    PluginNav.#bindTaskbarMenu(menu, dropdown);
    return menu;
  }

  /**
   * Mirrors VRCNext's `activateMenu`: the dropdown is `position: fixed`, so it is positioned
   * from the menu's rect on open, and hovering switches menus while one is already open.
   */
  static #bindTaskbarMenu(menu: HTMLElement, dropdown: HTMLElement): void {
    const open = (): void => {
      (globalThis as { tbCloseMenus?: () => void }).tbCloseMenus?.();
      const rect = menu.getBoundingClientRect();
      dropdown.style.top = `${String(rect.bottom)}px`;
      dropdown.style.left = `${String(rect.left)}px`;
      menu.classList.add('open');
    };

    menu.addEventListener('mousedown', (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && dropdown.contains(target)) return;
      event.stopPropagation();
      if (menu.classList.contains('open')) menu.classList.remove('open');
      else open();
    });

    menu.addEventListener('mouseenter', () => {
      // Another menu is already open, so hovering should switch to this one.
      if (document.querySelector('.tb-menu-item.open') !== null) open();
    });
  }

  dispose(): void {
    for (const dispose of this.#disposers.reverse()) {
      try {
        dispose();
      } catch (error) {
        globalThis.console.error('[vrcnext-plugins] nav teardown failed', error);
      }
    }
    this.#disposers.length = 0;
    this.#tabs.clear();
    this.#rendered.clear();
  }
}
