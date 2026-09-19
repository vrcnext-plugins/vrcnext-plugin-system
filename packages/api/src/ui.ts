/**
 * UI injection surface.
 *
 * VRCNext owns the stylesheet, so plugin UI is built from the host's own classes
 * (`vrcn-panel-card`, `sf-toggle-row`, `nav-btn`, `msi` icon spans). A hand-rolled control
 * would lose theming, the font-size offset and the custom-theme cascade.
 *
 * Icons are [Material Symbols Rounded](https://fonts.google.com/icons) ligature names, which is
 * what VRCNext's `.msi` spans already render.
 */

import type { Disposable } from './disposable.js';
import type { ToastOptions } from './notifications.js';

export type { ToastOptions };

/** A Material Symbols ligature name, e.g. `extension`, `notifications`, `travel_explore`. */
export type IconName = string;

export interface PanelHandle extends Disposable {
  /** Root element of the injected panel. Owned by the plugin; cleared on dispose. */
  readonly element: HTMLElement;
}

export interface NavTabOptions {
  readonly label: string;
  readonly icon: IconName;
  /** Renders the tab body. Called once, lazily, the first time the tab is opened. */
  render(container: HTMLElement): void | Promise<void>;
  /** Groups the entry under an existing sidebar group, e.g. `Tools`. */
  readonly group?: string;
}

export interface SettingsCardOptions {
  readonly title: string;
  readonly icon: IconName;
  /** Renders extra controls below the schema-derived ones. */
  render?(container: HTMLElement): void;
}

export interface DashboardCardOptions {
  readonly title: string;
  readonly icon: IconName;
  render(container: HTMLElement): void | Promise<void>;
  /** Lower sorts earlier among plugin cards. Defaults to 100. */
  readonly order?: number;
}

export interface UiApi {
  /**
   * Adds a sidebar entry and its tab body. The tab is removed and the nav button restored on
   * dispose, so a disabled plugin leaves no orphaned chrome behind.
   */
  addNavTab(options: NavTabOptions): PanelHandle;

  /**
   * Adds a card to the dashboard (tab 0). VRCNext re-renders the dashboard on data changes, so
   * the card is re-attached automatically until disposed.
   */
  addDashboardCard(options: DashboardCardOptions): PanelHandle;

  /**
   * Injects a stylesheet scoped to this plugin. Removed on dispose, so a disabled plugin does
   * not leave styling behind.
   */
  injectCss(css: string): PanelHandle;

  /** Adds a card to VRCNext's own settings page, below the plugin's generated settings rows. */
  addSettingsCard(options: SettingsCardOptions): PanelHandle;

  /** Shows a VRCNext toast. Routed through the host's own toast renderer. */
  toast(options: ToastOptions): void;

  /**
   * Creates an element using VRCNext's classes. Prefer this over `document.createElement` so
   * markup stays consistent with the host when its stylesheet changes.
   */
  createCard(title: string, icon: IconName): HTMLElement;

  /** Creates a labelled toggle row matching VRCNext's `sf-toggle-row` markup. */
  createToggleRow(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement;
}
