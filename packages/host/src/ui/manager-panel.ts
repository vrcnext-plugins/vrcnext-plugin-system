/**
 * The "Manage Plugins" tab — add a repository, install plugins, toggle them.
 *
 * Built from {@link widgets}, which are VRCNext's own markup, so this reads as a native settings
 * section: real switches rather than bare checkboxes, `.vrcn-button` actions, `.vrcn-edit-field`
 * inputs.
 *
 * Rendering is a full redraw of a small list. That is cheap here and avoids a diffing layer that
 * would be more code than the panel itself.
 */

import type { PluginId, RepoId } from '@vrcnext/plugin-api';

import type { PluginManager } from '../plugin-manager.js';
import { element } from './dom.js';
import {
  button,
  card,
  controlRow,
  description,
  emptyState,
  grid,
  panelLayout,
  row,
  textField,
  toggle,
  value,
} from './widgets.js';

export interface ManagerPanelDeps {
  readonly manager: PluginManager;
  readonly onError: (message: string) => void;
}

export class ManagerPanel {
  readonly #deps: ManagerPanelDeps;
  #root: HTMLElement | undefined;
  #pending = '';

  constructor(deps: ManagerPanelDeps) {
    this.#deps = deps;
  }

  render(container: HTMLElement): void {
    const layout = panelLayout();
    container.replaceChildren(layout);
    this.#root = layout;
    this.refresh();
  }

  refresh(): void {
    const root = this.#root;
    if (root === undefined) return;

    const { repos } = this.#deps.manager;
    root.replaceChildren(this.#buildAddCard());

    if (repos.length === 0) {
      const empty = card('Repositories', 'folder_open');
      empty.appendChild(
        emptyState('No repositories yet. Add one above to browse and install its plugins.'),
      );
      root.appendChild(empty);
      return;
    }
    root.appendChild(grid(repos.map((repo) => this.#buildRepoCard(repo.id)), 360));
  }

  #buildAddCard(): HTMLElement {
    const panel = card('Add a plugin repository', 'link');

    const input = textField({
      value: this.#pending,
      placeholder: 'owner/repo or https://github.com/owner/repo',
      // Keep what was typed across the redraw that follows a failed add.
      onCommit: (next) => { this.#pending = next; },
    });
    input.style.flex = '1';

    const add = button({
      label: 'Add',
      icon: 'add',
      onClick: () => {
        const url = input.value.trim();
        if (url.length === 0) return;
        add.disabled = true;
        this.#pending = url;
        void this.#deps.manager
          .addRepo(url)
          .then(() => { this.#pending = ''; })
          .catch((error: unknown) => {
            this.#deps.onError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            add.disabled = false;
            this.refresh();
          });
      },
    });

    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') add.click();
    });

    const line = controlRow(input, add);
    line.style.marginBottom = '10px';
    panel.appendChild(line);
    panel.appendChild(
      description(
        'Plugins run with the full authority of this page — your VRChat session, your settings. ' +
          'There is no sandbox. Only add repositories you trust.',
      ),
    );
    return panel;
  }

  #buildRepoCard(repoId: RepoId): HTMLElement {
    const repo = this.#deps.manager.repos.find((candidate) => candidate.id === repoId);
    if (repo === undefined) return card();

    const panel = card(repo.name, 'folder_open');

    if (repo.plugins.length === 0) {
      panel.appendChild(emptyState('This repository lists no plugins.'));
    }
    for (const manifest of repo.plugins) {
      panel.appendChild(this.#buildPluginRow(repoId, manifest));
    }

    panel.appendChild(
      controlRow(
        button({
          label: 'Refresh',
          icon: 'refresh',
          onClick: () => { void this.#run(this.#deps.manager.refreshRepo(repoId)); },
        }),
        button({
          label: 'Remove',
          icon: 'delete',
          onClick: () => { void this.#run(this.#deps.manager.removeRepo(repoId)); },
        }),
      ),
    );
    return panel;
  }

  #buildPluginRow(
    repoId: RepoId,
    manifest: {
      readonly id: PluginId;
      readonly name: string;
      readonly version: string;
      readonly description: string;
      readonly author?: string;
    },
  ): HTMLElement {
    const installed = this.#deps.manager.findInstalled(repoId, manifest.id);
    const byline = manifest.author === undefined ? '' : ` · ${manifest.author}`;
    const detail = `v${manifest.version}${byline} — ${manifest.description}`;

    if (installed === undefined) {
      return row(
        manifest.name,
        button({
          label: 'Install',
          icon: 'download',
          onClick: () => { void this.#run(this.#deps.manager.installPlugin(repoId, manifest.id)); },
        }),
        detail,
      );
    }

    // Installed: a switch to enable, plus the uninstall action beside it.
    const controls = element('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:10px;';
    controls.append(
      value(installed.enabled ? 'Enabled' : 'Disabled'),
      toggle(installed.enabled, (next) => {
        void this.#run(this.#deps.manager.setEnabled(installed.key, next));
      }),
    );
    return row(manifest.name, controls, detail);
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
