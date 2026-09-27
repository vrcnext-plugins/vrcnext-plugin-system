/**
 * The "Manage Plugins" tab.
 *
 * Until the bridge is connected this is only the Bridge card. Connected, it adds the install
 * field with its progress list, the installed plugins, and the update controls. Rendering is a
 * full redraw of a small list, which is cheap and avoids a diffing layer.
 */

import type { PluginId } from '@vrcnext/plugin-api';

import type { BridgeClient } from '../capabilities/native.js';
import type { PermissionBroker } from '../permissions/broker.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import {
  BRIDGE_DOCS_URL,
  describeError,
  isApprovalUnavailable,
  STEP_AWAITING_CONFIRMATION,
  toProgress,
  type Progress,
} from '../plugins/plugins-service.js';
import { buildBridgeCard } from './bridge-card.js';
import { element } from './dom.js';
import { buildPluginCard, type PluginView } from './plugin-card.js';
import { button, card, controlRow, description, emptyState, grid, panelLayout, textField, value } from './widgets.js';

export interface ManagerPanelDeps {
  readonly manager: PluginManager;
  readonly native: BridgeClient;
  readonly broker: PermissionBroker;
  readonly openSettings: (id: PluginId) => boolean;
  readonly onError: (message: string) => void;
  readonly openUrl: (url: string) => void;
}

/** Most progress lines kept per operation. */
const PROGRESS_LINES = 12;

export class ManagerPanel {
  readonly #deps: ManagerPanelDeps;
  #root: HTMLElement | undefined;
  #pendingUrl = '';
  #busy = false;
  /** Lines from `progress` pushes, keyed by `op:id`, cleared when the request settles. */
  readonly #progress = new Map<string, Progress[]>();
  #lastError: { readonly message: string; readonly docs: boolean } | undefined;
  readonly #openChangelogs = new Set<string>();
  #checkedUpdates = false;
  readonly #unsubscribe: (() => void)[] = [];

  constructor(deps: ManagerPanelDeps) {
    this.#deps = deps;
    this.#unsubscribe.push(
      deps.native.onStatus(() => { this.refresh(); }),
      deps.native.onPush((event, data) => { this.#onPush(event, data); }),
      deps.manager.onChange(() => { this.refresh(); }),
    );
  }

  dispose(): void {
    for (const fn of this.#unsubscribe.splice(0)) fn();
  }

  render(container: HTMLElement): void {
    const layout = panelLayout();
    container.replaceChildren(layout);
    this.#root = layout;
    this.refresh();
    // Check on open, once, so the badges are there without pressing the button.
    if (this.#deps.native.status === 'connected' && !this.#checkedUpdates) this.#checkUpdates();
  }

  refresh(): void {
    const root = this.#root;
    if (root === undefined) return;
    // Until the bridge is paired there is nothing else to show, so the pairing card lives here;
    // once connected it moves to the Plugin System tab, where the rest of the status is.
    if (this.#deps.native.status !== 'connected') {
      root.replaceChildren(buildBridgeCard({ native: this.#deps.native, openUrl: this.#deps.openUrl }));
      return;
    }
    root.replaceChildren(this.#buildInstallCard(), this.#buildUpdatesCard(), this.#buildList());
  }

  #onPush(event: string, data: unknown): void {
    if (event !== 'progress') return;
    const progress = toProgress(data);
    if (progress === undefined) return;
    const key = `${progress.op}:${progress.id}`;
    const lines = this.#progress.get(key) ?? [];
    lines.push(progress);
    this.#progress.set(key, lines.slice(-PROGRESS_LINES));
    this.refresh();
  }

  /** Run one bridge operation: disables the controls, clears its progress when done. */
  #run(work: () => Promise<unknown>): void {
    this.#busy = true;
    this.#lastError = undefined;
    this.refresh();
    void work()
      .catch((error: unknown) => {
        this.#lastError = { message: describeError(error), docs: isApprovalUnavailable(error) };
        this.#deps.onError(this.#lastError.message);
      })
      .finally(() => {
        this.#busy = false;
        this.#progress.clear();
        this.refresh();
      });
  }

  #checkUpdates(): void {
    this.#checkedUpdates = true;
    void this.#deps.manager.checkUpdates().catch((error: unknown) => {
      this.#deps.onError(`Update check failed: ${describeError(error)}`);
    });
  }

  #buildInstallCard(): HTMLElement {
    const panel = card('Install a plugin', 'download');
    const input = textField({
      value: this.#pendingUrl,
      placeholder: 'https://github.com/owner/plugin-repo',
      onCommit: (next) => { this.#pendingUrl = next; },
    });
    const install = button({
      label: 'Install',
      icon: 'add',
      disabled: this.#busy,
      onClick: () => {
        const url = input.value.trim();
        if (url.length === 0) return;
        this.#pendingUrl = url;
        this.#run(async () => {
          await this.#deps.manager.install(url);
          this.#pendingUrl = '';
        });
      },
    });
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') install.click();
    });
    panel.appendChild(controlRow(input, install));
    panel.appendChild(
      description(
        'A flat git repository over https with plugin.json and main.ts at its root. The bridge ' +
          'clones it, checks its manifest and source policy, asks you to confirm on the desktop, ' +
          'and rebuilds the bundle. Plugins run with the authority of this page — there is no sandbox.',
      ),
    );
    const progress = this.#buildProgress();
    if (progress !== undefined) panel.appendChild(progress);
    return panel;
  }

  #buildProgress(): HTMLElement | undefined {
    const error = this.#lastError;
    if (this.#progress.size === 0 && error === undefined) return undefined;
    const list = element('div', 'folder-list');
    list.style.cssText = 'font-size:calc(12px + var(--fs-off, 0px));line-height:1.6;';
    for (const [key, lines] of this.#progress) {
      list.appendChild(element('div', 'sf-section-label', key));
      for (const line of lines) {
        const text =
          line.step === STEP_AWAITING_CONFIRMATION
            ? 'Confirm on your desktop…'
            : `${line.step}${line.message === '' ? '' : ` — ${line.message}`}`;
        list.appendChild(element('div', undefined, text));
      }
    }
    if (error !== undefined) {
      const line = element('div', undefined, error.message);
      line.style.color = 'var(--err)';
      list.appendChild(line);
      if (error.docs) {
        list.appendChild(
          button({ label: 'Bridge documentation', icon: 'open_in_new', onClick: () => { this.#deps.openUrl(BRIDGE_DOCS_URL); } }),
        );
      }
    }
    return list;
  }

  #buildUpdatesCard(): HTMLElement {
    const { manager } = this.#deps;
    const panel = card('Updates', 'system_update_alt');
    const count = manager.updates.length;
    panel.appendChild(
      controlRow(
        button({ label: 'Check for updates', icon: 'refresh', disabled: this.#busy, onClick: () => { this.#checkUpdates(); } }),
        button({
          label: count === 0 ? 'Update all' : `Update all (${String(count)})`,
          icon: 'download',
          disabled: this.#busy || count === 0,
          onClick: () => { this.#run(() => manager.updateAll()); },
        }),
        value(
          !this.#checkedUpdates
            ? 'Not checked yet.'
            : count === 0
              ? 'Everything is up to date.'
              : `${String(count)} plugin${count === 1 ? '' : 's'} can be updated.`,
        ),
      ),
    );
    panel.appendChild(
      description(
        'Each update is confirmed on the desktop, one plugin at a time. After a rebuild, reload ' +
          'VRCNext to run the new code.',
      ),
    );
    return panel;
  }

  #views(): readonly PluginView[] {
    const { manager } = this.#deps;
    const ids = new Set<PluginId>();
    for (const p of manager.installed) ids.add(p.id);
    for (const p of manager.compiled) ids.add(p.manifest.id);
    return [...ids].sort().map((id) => ({
      id,
      installed: manager.installed.find((p) => p.id === id),
      manifest: manager.compiledById(id)?.manifest,
      update: manager.updates.find((u) => u.id === id),
    }));
  }

  #buildList(): HTMLElement {
    const views = this.#views();
    if (views.length === 0) {
      const empty = card('Installed plugins', 'extension');
      empty.appendChild(emptyState('No plugins yet. Install one above.'));
      return empty;
    }
    const cards = views.map((view) =>
      buildPluginCard(view, {
        manager: this.#deps.manager,
        broker: this.#deps.broker,
        openSettings: this.#deps.openSettings,
        run: (work) => { this.#run(work); },
        openChangelogs: this.#openChangelogs,
      }),
    );
    return grid(cards, 420);
  }
}
