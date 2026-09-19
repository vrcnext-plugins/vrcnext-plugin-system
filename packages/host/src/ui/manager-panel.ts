/**
 * The "Plugins" tab — where the user pastes a repository URL and toggles plugins.
 *
 * Rendering is a full redraw of a small list. That is cheap here and avoids a diffing layer
 * that would be more code than the panel itself.
 */

import type { PluginId, RepoId } from '@vrcnext/plugin-api';

import type { PluginManager } from '../plugin-manager.js';
import { CLASSES, element, iconSpan } from './dom.js';

export interface ManagerPanelDeps {
  readonly manager: PluginManager;
  readonly onError: (message: string) => void;
}

export class ManagerPanel {
  readonly #deps: ManagerPanelDeps;
  #root: HTMLElement | undefined;

  constructor(deps: ManagerPanelDeps) {
    this.#deps = deps;
  }

  render(container: HTMLElement): void {
    this.#root = container;
    this.refresh();
  }

  refresh(): void {
    const root = this.#root;
    if (root === undefined) return;
    root.replaceChildren();
    root.appendChild(this.#buildAddCard());
    for (const repo of this.#deps.manager.repos) {
      root.appendChild(this.#buildRepoCard(repo.id));
    }
  }

  #buildAddCard(): HTMLElement {
    const card = element('div', CLASSES.card);
    const header = element('div', CLASSES.cardHeader);
    header.appendChild(iconSpan('add_link'));
    header.appendChild(element('span', undefined, 'Add a plugin repository'));
    card.appendChild(header);

    const row = element('div', CLASSES.toggleRow);
    const input = element('input');
    input.type = 'text';
    input.placeholder = 'owner/repo or https://github.com/owner/repo';
    input.style.flex = '1';

    const button = element('button', undefined, 'Add');
    const submit = (): void => {
      const value = input.value.trim();
      if (value.length === 0) return;
      button.disabled = true;
      void this.#deps.manager
        .addRepo(value)
        .then(() => { input.value = ''; this.refresh(); })
        .catch((error: unknown) => {
          this.#deps.onError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => { button.disabled = false; });
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') submit();
    });

    row.append(input, button);
    card.appendChild(row);

    const note = element(
      'div',
      undefined,
      'Plugins run with full access to your VRChat session. Only add repositories you trust.',
    );
    note.style.cssText = 'font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:8px 0;';
    card.appendChild(note);
    return card;
  }

  #buildRepoCard(repoId: RepoId): HTMLElement {
    const repo = this.#deps.manager.repos.find((r) => r.id === repoId);
    const card = element('div', CLASSES.card);
    if (repo === undefined) return card;

    const header = element('div', CLASSES.cardHeader);
    header.appendChild(iconSpan('folder_open'));
    header.appendChild(element('span', undefined, repo.name));
    card.appendChild(header);

    for (const manifest of repo.plugins) {
      card.appendChild(this.#buildPluginRow(repoId, manifest.id, manifest.name, manifest.version));
    }

    const actions = element('div', CLASSES.toggleRow);
    const refresh = element('button', undefined, 'Refresh');
    refresh.addEventListener('click', () => {
      void this.#run(this.#deps.manager.refreshRepo(repoId));
    });
    const remove = element('button', undefined, 'Remove');
    remove.addEventListener('click', () => {
      void this.#run(this.#deps.manager.removeRepo(repoId));
    });
    actions.append(refresh, remove);
    card.appendChild(actions);

    return card;
  }

  #buildPluginRow(
    repoId: RepoId,
    pluginId: PluginId,
    name: string,
    version: string,
  ): HTMLElement {
    const installed = this.#deps.manager.findInstalled(repoId, pluginId);
    const row = element('div', CLASSES.toggleRow);

    const label = element('div');
    label.appendChild(element('div', undefined, `${name} — v${version}`));
    row.appendChild(label);

    if (installed === undefined) {
      const install = element('button', undefined, 'Install');
      install.addEventListener('click', () => {
        install.disabled = true;
        void this.#run(this.#deps.manager.installPlugin(repoId, pluginId));
      });
      row.appendChild(install);
      return row;
    }

    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = installed.enabled;
    toggle.addEventListener('change', () => {
      void this.#run(this.#deps.manager.setEnabled(installed.key, toggle.checked));
    });
    row.appendChild(toggle);
    return row;
  }

  async #run(work: Promise<unknown>): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.#deps.onError(error instanceof Error ? error.message : String(error));
    } finally {
      this.refresh();
    }
  }
}
