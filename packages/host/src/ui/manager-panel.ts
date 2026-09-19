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

import type { PluginManifest, RepoId } from '@vrcnext/plugin-api';

import type { PluginManager } from '../plugin-manager.js';
import { element } from './dom.js';
import {
  badge,
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
  #filter = '';

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

    root.appendChild(this.#buildSearchCard());

    const repoCards: HTMLElement[] = [];
    for (const repo of repos) {
      const built = this.#buildRepoCard(repo.id);
      if (built !== undefined) repoCards.push(built);
    }

    if (repoCards.length === 0 && this.#filter.length > 0) {
      const empty = card('Search Results', 'search');
      empty.appendChild(emptyState(`No plugins match "${this.#filter}".`));
      root.appendChild(empty);
      return;
    }

    root.appendChild(grid(repoCards, 360));
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

  #buildSearchCard(): HTMLElement {
    const totalPlugins = this.#deps.manager.plugins.length;
    const enabledPlugins = this.#deps.manager.plugins.filter((p) => p.enabled).length;

    const panel = card('Discover & Filter', 'search');
    const input = textField({
      value: this.#filter,
      placeholder: 'Filter plugins by name, description, tag, or keyword...',
      onCommit: (next) => {
        this.#filter = next.trim().toLowerCase();
        this.refresh();
      },
    });
    input.style.flex = '1';

    const clearBtn = button({
      label: 'Clear',
      icon: 'close',
      disabled: this.#filter.length === 0,
      onClick: () => {
        this.#filter = '';
        this.refresh();
      },
    });

    const searchRow = controlRow(input, clearBtn);
    searchRow.style.marginBottom = '8px';
    panel.appendChild(searchRow);

    const statSummary = `Installed: ${String(totalPlugins)} · Active: ${String(enabledPlugins)}`;
    panel.appendChild(description(statSummary));
    return panel;
  }

  #buildRepoCard(repoId: RepoId): HTMLElement | undefined {
    const repo = this.#deps.manager.repos.find((candidate) => candidate.id === repoId);
    if (repo === undefined) return undefined;

    const plugins = this.#filter.length === 0
      ? repo.plugins
      : repo.plugins.filter((p) => {
          const q = this.#filter;
          return (
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            (p.tags?.some((t) => t.toLowerCase().includes(q)) ?? false) ||
            (p.searchTerms?.some((s) => s.toLowerCase().includes(q)) ?? false)
          );
        });

    if (this.#filter.length > 0 && plugins.length === 0) {
      return undefined;
    }

    const panel = card(repo.name, 'folder_open');

    if (plugins.length === 0) {
      panel.appendChild(emptyState('This repository lists no plugins.'));
    }
    for (const manifest of plugins) {
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
    manifest: PluginManifest,
  ): HTMLElement {
    const installed = this.#deps.manager.findInstalled(repoId, manifest.id);
    const byline = manifest.author === undefined ? '' : ` · ${manifest.author}`;
    let detail = `v${manifest.version}${byline} — ${manifest.description}`;
    if (manifest.dependencies !== undefined && manifest.dependencies.length > 0) {
      detail += ` · Requires: ${manifest.dependencies.join(', ')}`;
    }

    const titleStack = element('div');
    titleStack.style.cssText = 'display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;';
    titleStack.appendChild(element('span', undefined, manifest.name));

    if (manifest.tags !== undefined) {
      for (const tag of manifest.tags) {
        titleStack.appendChild(badge('neutral', tag));
      }
    }

    if (installed === undefined) {
      return row(
        titleStack,
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
    return row(titleStack, controls, detail);
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
