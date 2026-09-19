/**
 * Implements {@link UiApi} against VRCNext's live DOM.
 *
 * VRCNext rebuilds its sidebar from `NAV_ITEMS_DEF` whenever the nav editor saves, which drops
 * any button injected into it. A `MutationObserver` re-attaches instead of a polling loop, so
 * re-injection happens on the same frame as the rebuild.
 */

import type {
  DashboardCardOptions,
  DisposableBag,
  NavTabOptions,
  PanelHandle,
  SettingsCardOptions,
  ToastOptions,
  UiApi,
} from '@vrcnext/plugin-api';

import type { InstalledPlugin } from '../registry/registry.js';
import {
  CLASSES,
  element,
  iconSpan,
  requireElement,
  SELECTORS,
  showTab,
  tabContainer,
  tabIndexOf,
} from './dom.js';

const PLUGIN_ATTR = 'data-vrcnext-plugin';

export interface PluginUi extends UiApi {
  /** Removes every panel this plugin injected. */
  disposeAll(): void;
}

export class UiHost {
  readonly #toast: (options: ToastOptions) => void;

  constructor(toast: (options: ToastOptions) => void) {
    this.#toast = toast;
  }

  forPlugin(record: InstalledPlugin, bag: DisposableBag): PluginUi {
    return new PluginUiImpl(record.manifest.id, this.#toast, bag);
  }

  /** UI owned by the host itself, such as the plugin manager tab. */
  forHost(bag: DisposableBag): PluginUi {
    return new PluginUiImpl('host', this.#toast, bag);
  }
}

class PluginUiImpl implements PluginUi {
  readonly #pluginId: string;
  readonly #toast: (options: ToastOptions) => void;
  readonly #bag: DisposableBag;
  readonly #handles = new Set<PanelHandle>();

  constructor(pluginId: string, toast: (options: ToastOptions) => void, bag: DisposableBag) {
    this.#pluginId = pluginId;
    this.#toast = toast;
    this.#bag = bag;
  }

  #track(handle: PanelHandle): PanelHandle {
    this.#handles.add(handle);
    this.#bag.add(handle);
    return handle;
  }

  addNavTab(options: NavTabOptions): PanelHandle {
    const tab = element('div', CLASSES.tab);
    tab.setAttribute(PLUGIN_ATTR, this.#pluginId);
    tabContainer().appendChild(tab);

    let rendered = false;
    const render = (): void => {
      if (rendered) return;
      rendered = true;
      void Promise.resolve(options.render(tab)).catch((error: unknown) => {
        globalThis.console.error(`[vrcnext-plugins:${this.#pluginId}] tab render failed`, error);
      });
    };

    const button = this.#buildNavButton(options, tab, render);
    const detachNav = attachNavButton(button);

    return this.#track({
      element: tab,
      dispose: (): void => {
        detachNav();
        tab.remove();
      },
    });
  }

  #buildNavButton(options: NavTabOptions, tab: HTMLElement, render: () => void): HTMLButtonElement {
    const button = element('button', CLASSES.navButton);
    button.setAttribute(PLUGIN_ATTR, this.#pluginId);
    button.appendChild(iconSpan(options.icon, 'ni'));
    button.appendChild(element('span', CLASSES.navLabel, options.label));

    // VRCNext's showTab() reads `onclick` with a regex to mark the active button, so the
    // attribute has to exist even though the real handler is a listener.
    const onClick = (): void => {
      render();
      showTab(tabIndexOf(tab));
    };
    button.addEventListener('click', onClick);
    button.setAttribute('onclick', `showTab(${String(tabIndexOf(tab))})`);

    return button;
  }

  addDashboardCard(options: DashboardCardOptions): PanelHandle {
    const card = this.createCard(options.title, options.icon);
    card.setAttribute(PLUGIN_ATTR, this.#pluginId);
    card.style.order = String(options.order ?? 100);
    void Promise.resolve(options.render(card)).catch((error: unknown) => {
      globalThis.console.error(`[vrcnext-plugins:${this.#pluginId}] dashboard render failed`, error);
    });

    // VRCNext rebuilds the dashboard whenever its data changes, which drops the card.
    const dashboard = requireElement(SELECTORS.dashboard);
    dashboard.appendChild(card);
    const observer = new MutationObserver(() => {
      if (!dashboard.contains(card)) dashboard.appendChild(card);
    });
    observer.observe(dashboard, { childList: true });

    return this.#track({
      element: card,
      dispose: (): void => {
        observer.disconnect();
        card.remove();
      },
    });
  }

  injectCss(css: string): PanelHandle {
    const style = element('style');
    style.setAttribute(PLUGIN_ATTR, this.#pluginId);
    style.textContent = css;
    document.head.appendChild(style);
    return this.#track({
      element: style,
      dispose: (): void => { style.remove(); },
    });
  }

  addSettingsCard(options: SettingsCardOptions): PanelHandle {
    const settingsTab = requireElement(SELECTORS.settingsTab);
    const card = this.createCard(options.title, options.icon);
    card.setAttribute(PLUGIN_ATTR, this.#pluginId);
    options.render?.(card);
    settingsTab.appendChild(card);

    return this.#track({
      element: card,
      dispose: (): void => { card.remove(); },
    });
  }

  toast(options: ToastOptions): void {
    this.#toast(options);
  }

  createCard(title: string, icon: string): HTMLElement {
    const card = element('div', CLASSES.card);
    const header = element('div', CLASSES.cardHeader);
    header.appendChild(iconSpan(icon));
    header.appendChild(element('span', undefined, title));
    card.appendChild(header);
    return card;
  }

  createToggleRow(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
    const row = element('div', CLASSES.toggleRow);
    row.appendChild(element('div', undefined, label));

    const wrapper = element('label', CLASSES.toggle);
    const input = element('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => { onChange(input.checked); });

    const track = element('div', CLASSES.toggleTrack);
    track.appendChild(element('div', CLASSES.toggleKnob));

    wrapper.appendChild(input);
    wrapper.appendChild(track);
    row.appendChild(wrapper);
    return row;
  }

  disposeAll(): void {
    for (const handle of [...this.#handles]) handle.dispose();
    this.#handles.clear();
  }
}

/**
 * Appends a button to the sidebar and re-appends it whenever VRCNext rebuilds the nav.
 * Returns a detach function that stops observing and removes the button.
 */
function attachNavButton(button: HTMLButtonElement): () => void {
  const sidebar = requireElement(SELECTORS.sidebar);
  sidebar.appendChild(button);

  const observer = new MutationObserver(() => {
    if (!sidebar.contains(button)) sidebar.appendChild(button);
  });
  observer.observe(sidebar, { childList: true, subtree: true });

  return (): void => {
    observer.disconnect();
    button.remove();
  };
}
