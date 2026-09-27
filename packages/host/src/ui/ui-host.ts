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
  SettingsSectionHandle,
  SettingsSectionOptions,
  SettingSpec,
  SettingsSchema,
  SettingsStore,
  SidebarGroupOptions,
  ToastOptions,
  UiApi,
} from '@vrcnext/plugin-api';

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
import { PluginNav } from './plugin-nav.js';
import { PLUGINS_SECTION, SettingsNav } from './settings-section.js';
import { HostUiKit } from './ui-kit.js';
import * as widgets from './widgets.js';

const SHARED_KIT = new HostUiKit();

const PLUGIN_ATTR = 'data-vrcnext-plugin';

export interface PluginUi extends UiApi {
  /** Removes every panel this plugin injected. */
  disposeAll(): void;
}

export interface UiHostOptions {
  readonly toast: (options: ToastOptions) => void;
  /** Where sidebar and menu interactions are logged, for the debug hub. */
  readonly onUiEvent?: (action: string, detail?: string) => void;
}

/** What every plugin's UI shares. */
interface Shared {
  readonly toast: (options: ToastOptions) => void;
  readonly onUiEvent: ((action: string, detail?: string) => void) | undefined;
  readonly settingsNav: SettingsNav;
  /** The host's Plugins section, once the host has created it. */
  readonly defaultSection: () => SettingsSectionHandle | undefined;
}

export class UiHost {
  readonly #shared: Shared;
  /**
   * The host's Plugins section, where plugin settings cards go by default. The host creates it
   * through the same API plugins use and sets it here once it exists.
   */
  pluginsSection: SettingsSectionHandle | undefined;

  constructor(options: UiHostOptions) {
    this.#shared = {
      toast: options.toast,
      onUiEvent: options.onUiEvent,
      settingsNav: new SettingsNav(),
      defaultSection: () => this.pluginsSection,
    };
  }

  forPlugin(
    pluginId: string,
    bag: DisposableBag,
    settings?: SettingsStore<SettingsSchema>,
    schema?: SettingsSchema,
  ): PluginUi {
    return new PluginUiImpl(pluginId, bag, { settings, schema, namespace: pluginId }, this.#shared);
  }

  /** UI owned by the host itself. Its ids are not namespaced: they are the page's own. */
  forHost(bag: DisposableBag): PluginUi {
    return new PluginUiImpl('host', bag, { namespace: undefined }, this.#shared);
  }

  /** The settings card a plugin added, if any. */
  static settingsCardOf(pluginId: string): HTMLElement | undefined {
    return document.querySelector<HTMLElement>(`[${PLUGIN_ATTR}="${pluginId}"][data-section="${PLUGINS_SECTION}"]`) ?? undefined;
  }
}

interface PluginUiContext {
  readonly settings?: SettingsStore<SettingsSchema> | undefined;
  readonly schema?: SettingsSchema | undefined;
  /** Prefix for ids that land in the page (`data-section`, element ids); none for the host. */
  readonly namespace: string | undefined;
}

class PluginUiImpl implements PluginUi {
  readonly #pluginId: string;
  readonly #bag: DisposableBag;
  readonly #settings: SettingsStore<SettingsSchema> | undefined;
  readonly #schema: SettingsSchema | undefined;
  readonly #namespace: string | undefined;
  readonly #shared: Shared;
  readonly #handles = new Set<PanelHandle>();

  constructor(pluginId: string, bag: DisposableBag, context: PluginUiContext, shared: Shared) {
    this.#pluginId = pluginId;
    this.#bag = bag;
    this.#settings = context.settings;
    this.#schema = context.schema;
    this.#namespace = context.namespace;
    this.#shared = shared;
  }

  #pageId(id: string): string {
    return this.#namespace === undefined ? id : `${this.#namespace}.${id}`;
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
    const section = options.section ?? this.#shared.defaultSection();
    if (section === undefined) throw new Error('The host has no Plugins section to put the card in yet.');
    section.attach(card);

    return this.#track({
      element: card,
      dispose: (): void => { card.remove(); },
    });
  }

  addSettingsSection(options: SettingsSectionOptions): SettingsSectionHandle {
    const binding = this.#shared.settingsNav.addSection({
      sectionId: this.#pageId(options.id),
      label: options.label,
      icon: options.icon,
    });
    binding.navItem.setAttribute(PLUGIN_ATTR, this.#pluginId);
    const handle: SettingsSectionHandle = {
      element: binding.navItem,
      sectionId: binding.sectionId,
      get active(): boolean { return binding.isActive(); },
      attach: (block): void => {
        // A card another plugin files here keeps its own owner; only unowned blocks become ours.
        if (!block.hasAttribute(PLUGIN_ATTR)) block.setAttribute(PLUGIN_ATTR, this.#pluginId);
        binding.attach(block);
      },
      open: (block): void => { binding.open(block); },
      dispose: (): void => { binding.remove(); },
    };
    this.#track(handle);
    return handle;
  }

  addSettingsDivider(): PanelHandle {
    const divider = this.#shared.settingsNav.addDivider();
    divider.setAttribute(PLUGIN_ATTR, this.#pluginId);
    return this.#track({ element: divider, dispose: (): void => { divider.remove(); } });
  }

  addSidebarGroup(options: SidebarGroupOptions): PanelHandle {
    const nav = new PluginNav({
      entries: options.entries,
      groupId: this.#pageId(options.id),
      groupLabel: options.label,
      groupIcon: options.icon,
      onError: (error, entry) => {
        globalThis.console.error(`[vrcnext-plugins:${this.#pluginId}] shortcut "${entry.label}" failed`, error);
      },
      ...(this.#shared.onUiEvent === undefined ? {} : { onUiEvent: this.#shared.onUiEvent }),
    });
    const group = nav.mount();
    group.setAttribute(PLUGIN_ATTR, this.#pluginId);
    return this.#track({ element: group, dispose: (): void => { nav.dispose(); } });
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
        if (spec.multiline === true) {
          const area = widgets.textArea({
            value: val,
            rows: 6,
            ...(spec.placeholder !== undefined ? { placeholder: spec.placeholder } : {}),
            onCommit: (next) => { void store.set(key, next); },
          });
          if (spec.disabled === true) area.disabled = true;
          return widgets.row(spec.label, area, spec.description, { stacked: true });
        }
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
    this.#shared.toast(options);
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
