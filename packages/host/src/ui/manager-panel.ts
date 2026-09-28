/**
 * The manage half of the Plugins section in VRCNext's Settings tab.
 *
 * Until the bridge is connected this is only the Bridge card. Connected, it is a status strip,
 * the installed plugins as rows that open, the install field with its progress list, and the
 * signing keys this machine has accepted — in that order, because "what do I have" is asked far
 * more often than "add another", and the keys are reference material you go looking for. Every
 * plugin's own settings card is attached below these by the host. Rendering is a full redraw of
 * a small list, which is cheap and avoids a diffing layer; what the user has opened is kept in
 * `#expanded` so a redraw does not fold their rows.
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
  type TrustedKey,
} from '../plugins/plugins-service.js';
import { buildBridgeCard } from './bridge-card.js';
import { element } from './dom.js';
import { buildPluginRows, type PluginView } from './plugin-row.js';
import { button, card, controlRow, description, emptyState, panelLayout, row, statusCard, textField } from './widgets.js';

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
  /** Which plugin rows are open. Kept across the full redraws below. */
  readonly #expanded = new Set<string>();
  #checkedUpdates = false;
  /** The trusted keys, as last read from the bridge; `undefined` until the first read lands. */
  #keys: readonly TrustedKey[] | undefined;
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
    // once connected it moves to the Plugin System section, where the rest of the status is.
    if (this.#deps.native.status !== 'connected') {
      root.replaceChildren(buildBridgeCard({ native: this.#deps.native, openUrl: this.#deps.openUrl }));
      return;
    }
    root.replaceChildren(
      this.#buildStatusCard(),
      this.#buildList(),
      this.#buildInstallCard(),
      this.#buildKeysCard(),
    );
    if (this.#keys === undefined) this.#loadKeys();
  }

  /** Read the trusted keys once per panel, and again whenever one is forgotten. */
  #loadKeys(): void {
    this.#keys = [];
    void this.#deps.manager
      .keys()
      .then((keys) => {
        this.#keys = keys;
        this.refresh();
      })
      .catch((error: unknown) => {
        this.#deps.onError(`Could not read the signing keys: ${describeError(error)}`);
      });
  }

  /**
   * Every signing key this machine has accepted, and what it signed.
   *
   * Forgetting one uninstalls nothing: it only means the next thing that key signs is confirmed
   * again, which is the honest description of what the trust store does.
   */
  #buildKeysCard(): HTMLElement {
    const panel = card('Signing keys', 'key');
    panel.appendChild(
      description(
        'A plugin can only be installed or updated if its repository carries a valid signature, ' +
          'and only under the key it was installed with. These are the keys you have accepted. ' +
          'Compare a fingerprint against the one its author publishes before trusting it.',
      ),
    );
    const keys = this.#keys ?? [];
    if (keys.length === 0) {
      panel.appendChild(emptyState('No keys accepted yet.'));
      return panel;
    }
    for (const key of keys) {
      const used = key.installed.length === 0 ? `Nothing installed · first seen for ${key.label}` : `Used by ${key.installed.join(', ')}`;
      panel.appendChild(
        row(
          key.keyId,
          button({
            label: 'Forget',
            icon: 'delete',
            disabled: this.#busy,
            onClick: () => {
              this.#run(async () => {
                await this.#deps.manager.forgetKey(key.keyId);
                this.#loadKeys();
              });
            },
          }),
          used,
        ),
      );
    }
    return panel;
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

  /** One line saying where things stand, with the two update controls beside it. */
  #buildStatusCard(): HTMLElement {
    const { manager } = this.#deps;
    const count = manager.updates.length;
    const installed = manager.installed.length;
    const label = !this.#checkedUpdates
      ? `${String(installed)} plugin${installed === 1 ? '' : 's'} installed`
      : count === 0
        ? `${String(installed)} plugin${installed === 1 ? '' : 's'}, all up to date`
        : `${String(count)} of ${String(installed)} can be updated`;
    return statusCard({
      tone: count === 0 ? 'online' : 'warn',
      label,
      action: controlRow(
        button({ label: 'Check for updates', icon: 'refresh', disabled: this.#busy, onClick: () => { this.#checkUpdates(); } }),
        button({
          label: 'Update all',
          icon: 'download',
          disabled: this.#busy || count === 0,
          onClick: () => { this.#run(() => manager.updateAll()); },
        }),
      ),
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
          'and rebuilds the bundle. Each update is confirmed the same way, one plugin at a time, ' +
          'and the new code runs after you reload VRCNext. Plugins run with the authority of this ' +
          'page — there is no sandbox.',
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
    const panel = card('Installed plugins', 'extension');
    panel.appendChild(
      buildPluginRows(this.#views(), {
        manager: this.#deps.manager,
        broker: this.#deps.broker,
        openSettings: this.#deps.openSettings,
        openUrl: this.#deps.openUrl,
        run: (work) => { this.#run(work); },
        expanded: this.#expanded,
        openChangelogs: this.#openChangelogs,
      }),
    );
    return panel;
  }
}
