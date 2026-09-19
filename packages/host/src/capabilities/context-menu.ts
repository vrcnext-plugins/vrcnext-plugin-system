/**
 * {@link ContextMenuApi} by appending into VRCNext's rendered menu.
 *
 * `getMenuConfig` lives in a module closure, so contributions cannot be merged into VRCNext's
 * item list. Instead a capture-phase `contextmenu` listener records the target, and a
 * `MutationObserver` on `#vn-ctx-menu` appends plugin buttons once VRCNext has rendered its own.
 * Our buttons carry their own listeners, so VRCNext's internal callback array is never touched.
 */

import type {
  ContextMenuApi,
  ContextMenuEntry,
  ContextMenuProvider,
  ContextMenuTarget,
  DisposableBag,
  PluginId,
} from '@vrcnext/plugin-api';

import { CLASSES, iconSpan } from '../ui/dom.js';

const MENU_ID = 'vn-ctx-menu';
const BODY_CLASS = 'vn-ctx-body';
const CONTRIBUTION_ATTR = 'data-vrcnext-plugin-item';

interface Registration {
  readonly pluginId: PluginId;
  readonly selector: string | undefined;
  readonly provider: ContextMenuProvider;
}

/** Reads the VRChat entity VRCNext tags onto elements via `data-vrc-*`. */
function entityOf(element: HTMLElement): ContextMenuTarget['entity'] {
  const holder = element.closest<HTMLElement>('[data-vrc-type][data-vrc-id]');
  const type = holder?.dataset['vrcType'];
  const id = holder?.dataset['vrcId'];
  if (type === undefined || id === undefined) return undefined;
  if (
    type !== 'user' &&
    type !== 'avatar' &&
    type !== 'world' &&
    type !== 'group' &&
    type !== 'instance'
  ) {
    return undefined;
  }
  return { type, id };
}

export class ContextMenuHub {
  readonly #registrations = new Set<Registration>();
  #lastTarget: HTMLElement | undefined;
  #observer: MutationObserver | undefined;

  install(): void {
    if (this.#observer !== undefined) return;

    // Capture phase runs before VRCNext's document-level bubble listener, so the target is
    // recorded even though VRCNext calls preventDefault().
    globalThis.addEventListener('contextmenu', this.#onContextMenu, { capture: true });

    this.#observer = new MutationObserver(() => { this.#onMenuMutated(); });
    this.#observer.observe(document.body, { childList: true, subtree: true });
  }

  uninstall(): void {
    globalThis.removeEventListener('contextmenu', this.#onContextMenu, { capture: true });
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#registrations.clear();
  }

  readonly #onContextMenu = (event: Event): void => {
    const target = event.target;
    this.#lastTarget = target instanceof HTMLElement ? target : undefined;
  };

  #onMenuMutated(): void {
    const menu = document.getElementById(MENU_ID);
    if (menu === null || menu.style.display === 'none') return;
    if (menu.querySelector(`[${CONTRIBUTION_ATTR}]`) !== null) return;

    const element = this.#lastTarget;
    if (element === undefined) return;
    void this.#appendContributions(menu, { element, entity: entityOf(element) });
  }

  async #appendContributions(menu: HTMLElement, target: ContextMenuTarget): Promise<void> {
    const body = menu.querySelector<HTMLElement>(`.${BODY_CLASS}`) ?? menu;

    for (const registration of this.#registrations) {
      if (registration.selector !== undefined && target.element.closest(registration.selector) === null) {
        continue;
      }
      let entries: readonly ContextMenuEntry[];
      try {
        entries = await registration.provider(target);
      } catch (error) {
        globalThis.console.error(
          `[vrcnext-plugins:${registration.pluginId}] context-menu provider threw`,
          error,
        );
        continue;
      }
      if (entries.length === 0) continue;
      body.appendChild(renderEntries(entries, registration.pluginId));
    }
  }

  add(registration: Registration): () => void {
    this.#registrations.add(registration);
    return (): void => { this.#registrations.delete(registration); };
  }
}

function renderEntries(
  entries: readonly ContextMenuEntry[],
  pluginId: PluginId,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    fragment.appendChild(renderEntry(entry, pluginId));
  }
  return fragment;
}

function renderEntry(entry: ContextMenuEntry, pluginId: PluginId): HTMLElement {
  if (entry.kind === 'divider') {
    const sep = document.createElement('div');
    sep.className = 'vn-ctx-sep';
    sep.setAttribute(CONTRIBUTION_ATTR, pluginId);
    return sep;
  }

  const button = document.createElement('button');
  button.className = 'vn-ctx-item';
  button.setAttribute(CONTRIBUTION_ATTR, pluginId);

  if (entry.kind === 'item' && entry.danger === true) button.classList.add('danger');
  if (entry.kind === 'submenu') button.classList.add('has-sub');

  button.appendChild(iconSpan(entry.icon));
  const label = document.createElement('span');
  label.className = 'vn-ctx-label';
  label.textContent = entry.label;
  button.appendChild(label);

  if (entry.kind === 'item' && entry.checked === true) {
    button.appendChild(iconSpan('check', 'vn-ctx-check'));
  }
  if (entry.kind === 'submenu') {
    button.appendChild(iconSpan('chevron_right', 'vn-ctx-arrow'));
    attachSubmenu(button, () => entry.items(), pluginId);
    return button;
  }

  const onSelect = (): void | Promise<void> => entry.onSelect();
  button.addEventListener('click', () => {
    hideMenu();
    void Promise.resolve(onSelect()).catch((error: unknown) => {
      globalThis.console.error(`[vrcnext-plugins:${pluginId}] menu action threw`, error);
    });
  });
  return button;
}

/** Submenus reuse VRCNext's floating renderer when available, else render inline on hover. */
function attachSubmenu(
  button: HTMLElement,
  items: () => readonly ContextMenuEntry[] | Promise<readonly ContextMenuEntry[]>,
  pluginId: PluginId,
): void {
  let panel: HTMLElement | undefined;
  button.addEventListener('mouseenter', () => {
    if (panel !== undefined) return;
    void Promise.resolve(items())
      .then((entries) => {
        panel = document.createElement('div');
        panel.id = 'vn-ctx-submenu-plugin';
        panel.className = CLASSES.card;
        panel.setAttribute(CONTRIBUTION_ATTR, pluginId);
        const rect = button.getBoundingClientRect();
        panel.style.cssText = `position:fixed;left:${String(rect.right)}px;top:${String(rect.top)}px;z-index:100000;`;
        panel.appendChild(renderEntries(entries, pluginId));
        document.body.appendChild(panel);
      })
      .catch((error: unknown) => {
        globalThis.console.error(`[vrcnext-plugins:${pluginId}] submenu failed`, error);
      });
  });
  button.addEventListener('mouseleave', () => {
    panel?.remove();
    panel = undefined;
  });
}

function hideMenu(): void {
  const hide: unknown = (globalThis as { VrcnHideContextMenu?: unknown }).VrcnHideContextMenu;
  if (typeof hide === 'function') (hide as () => void)();
  document.getElementById('vn-ctx-submenu-plugin')?.remove();
}

export class PluginContextMenuApi implements ContextMenuApi {
  readonly #hub: ContextMenuHub;
  readonly #pluginId: PluginId;
  readonly #bag: DisposableBag;

  constructor(hub: ContextMenuHub, pluginId: PluginId, bag: DisposableBag) {
    this.#hub = hub;
    this.#pluginId = pluginId;
    this.#bag = bag;
  }

  contribute(provider: ContextMenuProvider): () => void {
    const dispose = this.#hub.add({ pluginId: this.#pluginId, selector: undefined, provider });
    this.#bag.add(dispose);
    return dispose;
  }

  contributeFor(selector: string, provider: ContextMenuProvider): () => void {
    const dispose = this.#hub.add({ pluginId: this.#pluginId, selector, provider });
    this.#bag.add(dispose);
    return dispose;
  }

  open(x: number, y: number, entries: readonly ContextMenuEntry[]): void {
    const host = document.createElement('div');
    host.id = MENU_ID;
    host.className = CLASSES.card;
    host.style.cssText = `position:fixed;left:${String(x)}px;top:${String(y)}px;z-index:100000;`;
    host.appendChild(renderEntries(entries, this.#pluginId));
    document.body.appendChild(host);

    const close = (): void => { host.remove(); };
    globalThis.setTimeout(() => {
      globalThis.addEventListener('click', close, { once: true });
    }, 0);
    this.#bag.add(close);
  }
}
