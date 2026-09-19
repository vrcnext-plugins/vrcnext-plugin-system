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
  SettingSpec,
  SettingsSchema,
  SettingsStore,
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
import { HostUiKit } from './ui-kit.js';
import * as widgets from './widgets.js';

const SHARED_KIT = new HostUiKit();

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

  forPlugin(
    record: InstalledPlugin,
    bag: DisposableBag,
    settings?: SettingsStore<SettingsSchema>,
    schema?: SettingsSchema,
  ): PluginUi {
    return new PluginUiImpl(record.manifest.id, this.#toast, bag, { settings, schema });
  }

  /** UI owned by the host itself, such as the plugin manager tab. */
  forHost(bag: DisposableBag): PluginUi {
    return new PluginUiImpl('host', this.#toast, bag);
  }
}

interface PluginUiContext {
  readonly settings?: SettingsStore<SettingsSchema> | undefined;
  readonly schema?: SettingsSchema | undefined;
}

class PluginUiImpl implements PluginUi {
  readonly #pluginId: string;
  readonly #toast: (options: ToastOptions) => void;
  readonly #bag: DisposableBag;
  readonly #settings: SettingsStore<SettingsSchema> | undefined;
  readonly #schema: SettingsSchema | undefined;
  readonly #handles = new Set<PanelHandle>();

  constructor(
    pluginId: string,
    toast: (options: ToastOptions) => void,
    bag: DisposableBag,
    context?: PluginUiContext,
  ) {
    this.#pluginId = pluginId;
    this.#toast = toast;
    this.#bag = bag;
    this.#settings = context?.settings;
    this.#schema = context?.schema;
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

  /** Stateless, so every plugin shares one instance. */
  readonly kit = SHARED_KIT;

  /** The scrolling, gapped column VRCNext gives its own tabs. */
  createPanelLayout(): HTMLElement {
    return widgets.panelLayout();
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

    if (this.#settings !== undefined && this.#schema !== undefined) {
      for (const [key, spec] of Object.entries(this.#schema)) {
        if (spec.hidden === true) continue;
        const row = this.#renderSettingRow(key, spec, this.#settings);
        if (row !== undefined) card.appendChild(row);
      }
    }

    options.render?.(card);
    settingsTab.appendChild(card);

    return this.#track({
      element: card,
      dispose: (): void => { card.remove(); },
    });
  }

  #renderSettingRow(
    key: string,
    spec: SettingSpec,
    store: SettingsStore<SettingsSchema>,
  ): HTMLElement | undefined {
    switch (spec.kind) {
      case 'boolean': {
        const val = Boolean(store.get(key));
        const sw = widgets.toggle(val, (checked) => { void store.set(key, checked); });
        if (spec.disabled === true) {
          sw.querySelector('input')?.setAttribute('disabled', 'true');
        }
        return widgets.row(spec.label, sw, spec.description);
      }
      case 'string': {
        const val = String(store.get(key));
        const input = widgets.textField({
          value: val,
          ...(spec.placeholder !== undefined ? { placeholder: spec.placeholder } : {}),
          onCommit: (next) => { void store.set(key, next); },
        });
        if (spec.disabled === true) input.disabled = true;
        return widgets.row(spec.label, input, spec.description);
      }
      case 'number': {
        const currentVal = Number(store.get(key));
        if (spec.slider === true) {
          const range = element('input');
          range.type = 'range';
          range.min = String(spec.min ?? 0);
          range.max = String(spec.max ?? 100);
          range.step = String(spec.step ?? 1);
          range.value = String(currentVal);
          range.style.minWidth = '120px';
          if (spec.disabled === true) range.disabled = true;

          const display = widgets.value(String(currentVal));
          range.addEventListener('input', () => {
            display.textContent = range.value;
          });
          range.addEventListener('change', () => {
            const num = Number(range.value);
            if (!Number.isNaN(num)) void store.set(key, num);
          });
          const container = element('div');
          container.style.cssText = 'display:flex;align-items:center;gap:8px;';
          container.append(display, range);
          return widgets.row(spec.label, container, spec.description);
        }
        const input = widgets.textField({
          value: String(currentVal),
          onCommit: (next) => {
            const num = Number(next);
            if (!Number.isNaN(num)) void store.set(key, num);
          },
        });
        if (spec.disabled === true) input.disabled = true;
        return widgets.row(spec.label, input, spec.description);
      }
      case 'color': {
        const currentVal = String(store.get(key));
        const colorPicker = element('input');
        colorPicker.type = 'color';
        colorPicker.value = currentVal;
        colorPicker.style.cssText = 'width:36px;height:28px;border:none;border-radius:4px;cursor:pointer;background:transparent;';
        if (spec.disabled === true) colorPicker.disabled = true;
        colorPicker.addEventListener('change', () => {
          void store.set(key, colorPicker.value);
        });
        return widgets.row(spec.label, colorPicker, spec.description);
      }
      case 'select': {
        const currentVal = String(store.get(key));
        const sel = widgets.dropdown({
          options: spec.options,
          selected: currentVal,
          onChange: (next) => { void store.set(key, next); },
        });
        if (spec.disabled === true) sel.disabled = true;
        return widgets.row(spec.label, sel, spec.description);
      }
    }
  }

  toast(options: ToastOptions): void {
    this.#toast(options);
  }

  createCard(title: string, icon: string): HTMLElement {
    return widgets.card(title, icon);
  }

  createToggleRow(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
    return widgets.row(label, widgets.toggle(checked, onChange));
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
  // #navEl is the nav list; appending to the sidebar shell would land outside the scroll area.
  const nav = requireElement(SELECTORS.navList);
  nav.appendChild(button);

  const observer = new MutationObserver(() => {
    if (!nav.contains(button)) nav.appendChild(button);
  });
  observer.observe(nav, { childList: true });

  return (): void => {
    observer.disconnect();
    button.remove();
  };
}
