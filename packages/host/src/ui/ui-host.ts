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
  EntityPickOptions,
  NavTabOptions,
  PanelHandle,
  SettingsCardOptions,
  SettingsSectionHandle,
  SettingsSectionOptions,
  SettingsSchema,
  SettingsStore,
  SidebarGroupOptions,
  ToastOptions,
  UiApi,
  VrchatApi,
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
import { storeBinding } from './settings/binding.js';
import { openPicker } from './settings/entity-picker.js';
import { renderForm } from './settings/form.js';
import { SettingsNav } from './settings-section.js';
import { HostUiKit } from './ui-kit.js';
import * as widgets from './widgets.js';

const SHARED_KIT = new HostUiKit();

const PLUGIN_ATTR = 'data-vrcnext-plugin';

export interface PluginUi extends UiApi {
  /** Removes every panel this plugin injected. */
  disposeAll(): void;
}

/** Who a {@link UiHost.forPlugin} UI belongs to, and what its settings card draws. */
export interface PluginUiOptions {
  readonly id: string;
  /** The plugin's display name, which is what its settings section is labelled. */
  readonly name: string;
  readonly bag: DisposableBag;
  readonly settings?: SettingsStore<SettingsSchema> | undefined;
  readonly schema?: SettingsSchema | undefined;
}

export interface UiHostOptions {
  readonly toast: (options: ToastOptions) => void;
  /** Feeds the entity pickers. Ungated: the picker acts for the user, not the plugin. */
  readonly vrchat: VrchatApi;
  /** Where sidebar and menu interactions are logged, for the debug hub. */
  readonly onUiEvent?: (action: string, detail?: string) => void;
}

/** What every plugin's UI shares. */
interface Shared {
  readonly toast: (options: ToastOptions) => void;
  readonly vrchat: VrchatApi;
  readonly onUiEvent: ((action: string, detail?: string) => void) | undefined;
  readonly settingsNav: SettingsNav;
  /** The host's Plugins section, once the host has created it. */
  readonly defaultSection: () => SettingsSectionHandle | undefined;
  /** A plugin's settings card, so the Plugins list can jump to it. */
  readonly registerCard: (pluginId: string, section: SettingsSectionHandle, card: HTMLElement) => () => void;
  /** Counts the plugin sections below the divider, which is hidden while there are none. */
  readonly noteSection: (delta: number) => void;
}

export class UiHost {
  readonly #shared: Shared;
  readonly #cards = new Map<string, { section: SettingsSectionHandle; card: HTMLElement }>();
  #divider: HTMLElement | undefined;
  #sections = 0;

  /**
   * The host's Plugins section, where the host's own manager panel lives. The host creates it
   * through the same API plugins use and sets it here once it exists.
   */
  pluginsSection: SettingsSectionHandle | undefined;

  constructor(options: UiHostOptions) {
    this.#shared = {
      toast: options.toast,
      vrchat: options.vrchat,
      onUiEvent: options.onUiEvent,
      settingsNav: new SettingsNav(),
      defaultSection: () => this.pluginsSection,
      registerCard: (pluginId, section, card) => {
        this.#cards.set(pluginId, { section, card });
        return (): void => { this.#cards.delete(pluginId); };
      },
      noteSection: (delta) => {
        this.#sections += delta;
        if (this.#divider !== undefined) this.#divider.style.display = this.#sections > 0 ? '' : 'none';
      },
    };
  }

  /**
   * The rule the nav follows below VRCNext's own sections: the host's two, a divider, then one
   * section per plugin that has settings. The divider is the host's, so it survives a plugin
   * being disabled, and it is hidden while no plugin is showing anything.
   */
  setPluginDivider(divider: HTMLElement): void {
    this.#divider = divider;
    divider.style.display = this.#sections > 0 ? '' : 'none';
  }

  forPlugin(options: PluginUiOptions): PluginUi {
    const { id, name, bag, settings, schema } = options;
    return new PluginUiImpl(id, bag, { settings, schema, namespace: id, name }, this.#shared);
  }

  /** UI owned by the host itself. Its ids are not namespaced: they are the page's own. */
  forHost(bag: DisposableBag): PluginUi {
    return new PluginUiImpl('host', bag, { namespace: undefined, name: 'Plugin System' }, this.#shared);
  }

  /** The settings card a plugin added, if any. */
  settingsCardOf(pluginId: string): HTMLElement | undefined {
    return this.#cards.get(pluginId)?.card;
  }

  /** Opens VRCNext's Settings on a plugin's own section, scrolled to its card. */
  openSettingsOf(pluginId: string): boolean {
    const entry = this.#cards.get(pluginId);
    if (entry === undefined) return false;
    entry.section.open(entry.card);
    return true;
  }
}

interface PluginUiContext {
  readonly settings?: SettingsStore<SettingsSchema> | undefined;
  readonly schema?: SettingsSchema | undefined;
  /** Prefix for ids that land in the page (`data-section`, element ids); none for the host. */
  readonly namespace: string | undefined;
  /** What the plugin is called, which is what its settings section is labelled. */
  readonly name: string;
}

class PluginUiImpl implements PluginUi {
  readonly #pluginId: string;
  readonly #bag: DisposableBag;
  readonly #settings: SettingsStore<SettingsSchema> | undefined;
  readonly #schema: SettingsSchema | undefined;
  readonly #namespace: string | undefined;
  readonly #name: string;
  readonly #shared: Shared;
  readonly #handles = new Set<PanelHandle>();
  /** Created the first time this plugin files a settings card, and removed with the plugin. */
  #ownSection: SettingsSectionHandle | undefined;
  /** Whether a settings card has already been given the schema form. */
  #formDrawn = false;

  constructor(pluginId: string, bag: DisposableBag, context: PluginUiContext, shared: Shared) {
    this.#pluginId = pluginId;
    this.#bag = bag;
    this.#settings = context.settings;
    this.#schema = context.schema;
    this.#namespace = context.namespace;
    this.#name = context.name;
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

    options.render?.(card);

    // The schema goes on one card, not on every card the plugin happens to add — and under the
    // card's own words rather than above them, so a description introduces its settings.
    const store = this.#settings;
    const wantsForm = options.settings ?? !this.#formDrawn;
    if (wantsForm && store !== undefined && this.#schema !== undefined) {
      this.#formDrawn = true;
      const disposers: (() => void)[] = [];
      const form = renderForm(this.#schema, storeBinding(store), {
        vrchat: this.#shared.vrchat,
        values: () => store.values,
        onError: (message, error) => {
          globalThis.console.error(`[vrcnext-plugins:${this.#pluginId}] ${message}`, error);
        },
        track: (dispose) => { disposers.push(dispose); },
      });
      card.appendChild(form);
      this.#bag.add(() => { for (const dispose of disposers) dispose(); });
    }

    const section = options.section ?? this.#settingsSection(options.icon);
    section.attach(card);
    const forget = this.#shared.registerCard(this.#pluginId, section, card);

    return this.#track({
      element: card,
      dispose: (): void => {
        forget();
        card.remove();
      },
    });
  }

  /**
   * Where a card goes when the plugin does not say: the host's Plugins section for the host
   * itself, and otherwise a section of the plugin's own, named after it, below the divider.
   * A plugin with several cards gets one section carrying all of them.
   */
  #settingsSection(icon: string): SettingsSectionHandle {
    if (this.#namespace === undefined) {
      const section = this.#shared.defaultSection();
      if (section === undefined) throw new Error('The host has no Plugins section to put the card in yet.');
      return section;
    }
    this.#ownSection ??= this.addSettingsSection({ id: 'settings', label: this.#name, icon });
    return this.#ownSection;
  }

  addSettingsSection(options: SettingsSectionOptions): SettingsSectionHandle {
    const binding = this.#shared.settingsNav.addSection({
      sectionId: this.#pageId(options.id),
      label: options.label,
      icon: options.icon,
    });
    binding.navItem.setAttribute(PLUGIN_ATTR, this.#pluginId);
    // The host's own sections sit above the divider and do not count towards showing it.
    let counted = this.#namespace !== undefined;
    if (counted) this.#shared.noteSection(1);
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
      dispose: (): void => {
        if (counted) {
          counted = false;
          this.#shared.noteSection(-1);
        }
        binding.remove();
      },
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

  toast(options: ToastOptions): void {
    this.#shared.toast(options);
  }

  pickEntity(options: EntityPickOptions): Promise<readonly string[] | undefined> {
    return openPicker(this.#shared.vrchat, options);
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
