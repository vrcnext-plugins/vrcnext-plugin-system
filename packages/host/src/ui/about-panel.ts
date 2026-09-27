/**
 * The "Plugin System" tab — host status, platform support, diagnostics, and about.
 *
 * Built entirely from {@link widgets}, which are VRCNext's own markup. It deliberately states
 * what the host *cannot* do alongside what it can, so a user does not have to discover the
 * platform gates by watching a plugin silently do nothing.
 */

import { API_VERSION } from '../api-version.js';
import type { BridgeClient } from '../capabilities/native.js';
import type { DebugHub } from '../log/debug-hub.js';
import type { LogSink } from '../log/log-sink.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import { buildBridgeCard } from './bridge-card.js';
import { badge, button, card, controlRow, description, grid, panelLayout, row, toggle, value } from './widgets.js';

const REPO_URL = 'https://github.com/vrcnext-plugins/vrcnext-plugin-system';
const DOCS_URL = 'https://vrcnext-plugins.github.io/';

export interface AboutPanelDeps {
  readonly manager: PluginManager;
  readonly sink: LogSink;
  readonly native: BridgeClient;
  readonly debugHub: DebugHub;
  readonly isLinux: () => boolean;
  readonly openUrl: (url: string) => void;
}

export class AboutPanel {
  readonly #deps: AboutPanelDeps;
  #root: HTMLElement | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(deps: AboutPanelDeps) {
    this.#deps = deps;
  }

  render(container: HTMLElement): void {
    const layout = panelLayout();
    container.replaceChildren(layout);
    this.#root = layout;
    this.#unsubscribe ??= this.#deps.native.onStatus(() => { this.refresh(); });
    this.refresh();
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  refresh(): void {
    const root = this.#root;
    if (root === undefined) return;
    root.replaceChildren(
      buildBridgeCard({ native: this.#deps.native, openUrl: this.#deps.openUrl }),
      // Two columns whenever they fit (320px keeps them with the friends panel open), never more:
      // four narrow cards in a row read worse than two rows of two.
      grid([this.#buildStatus(), this.#buildPlatform(), this.#buildDiagnostics(), this.#buildAbout()], 320, 2),
    );
  }

  #buildStatus(): HTMLElement {
    const panel = card('Status', 'info');
    const { manager, sink, native } = this.#deps;
    const enabled = manager.compiled.filter((p) => manager.isEnabled(p.manifest.id)).length;
    for (const [label, text] of [
      ['Plugin API version', API_VERSION],
      ['Bridge', native.status.replace(/_/g, ' ')],
      ['Bridge version', native.describe()?.version ?? '—'],
      ['Plugins in this bundle', String(manager.compiled.length)],
      ['Plugins installed', String(manager.installed.length)],
      ['Plugins enabled', String(enabled)],
      ['Log records held', String(sink.records.length)],
      ['Page origin', globalThis.location.origin],
    ] as const) {
      panel.appendChild(row(label, value(text)));
    }
    return panel;
  }

  #buildPlatform(): HTMLElement {
    const panel = card('Platform support', 'desktop_windows');
    const linux = this.#deps.isLinux();
    panel.appendChild(description(linux ? 'Running on Linux.' : 'Running on Windows.'));
    const bridge = this.#deps.native.status === 'connected' ? badge('ok', 'Via bridge') : badge('warn', 'Bridge not connected');
    for (const [label, badgeEl] of [
      ['OSC', linux ? badge('warn', 'Windows only') : badge('ok', 'Available')],
      ['Desktop notifications', linux ? bridge : badge('ok', 'Available')],
      ['VR overlay notifications', bridge],
      ['In-app toasts, modals', badge('ok', 'Available')],
      ['Host events, actions, game log', badge('ok', 'Available')],
      ['UI, context menus, routes', badge('ok', 'Available')],
    ] as const) {
      panel.appendChild(row(label, badgeEl));
    }
    return panel;
  }

  #buildDiagnostics(): HTMLElement {
    const panel = card('Diagnostics', 'bug_report');
    panel.appendChild(
      description(
        'When enabled, browser console errors and warnings are mirrored into the host log, and ' +
          'UI interaction events are recorded. Everything logged is also mirrored to the bridge’s ' +
          'plugins.log.',
      ),
    );
    panel.appendChild(
      row('Verbose debug logging', toggle(this.#deps.debugHub.enabled, (next) => { this.#deps.debugHub.enabled = next; })),
    );
    return panel;
  }

  #buildAbout(): HTMLElement {
    const panel = card('About', 'extension');
    panel.appendChild(
      description(
        'A plugin runtime for VRCNext that installs as a custom theme and never modifies VRCNext ' +
          'itself. The VRCNext Bridge compiles the host and every installed plugin into one bundle; ' +
          'plugins run with the full authority of this page, so each capability is declared and ' +
          'each concrete use is confirmed the first time.',
      ),
    );
    panel.appendChild(
      controlRow(
        button({ label: 'Documentation', icon: 'description', onClick: () => { this.#deps.openUrl(DOCS_URL); } }),
        button({ label: 'Source', icon: 'terminal', onClick: () => { this.#deps.openUrl(REPO_URL); } }),
      ),
    );
    panel.appendChild(description('Released into the public domain under the Unlicense.'));
    return panel;
  }
}
