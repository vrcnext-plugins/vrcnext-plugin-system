/**
 * The "Plugin System" tab — host status, platform support, diagnostics, and about.
 *
 * Built entirely from {@link widgets}, which are VRCNext's own markup. It deliberately states
 * what the host *cannot* do alongside what it can, so a user does not have to discover the
 * platform gates by watching a plugin silently do nothing.
 *
 * Counts are four numbers, not four full-width rows: a label on the left and a digit on the far
 * right spends a whole line on a character. The bridge's own card states the connection, the
 * version and the services, so nothing here repeats them — the same fact in two places is one
 * fact that can be wrong in two places.
 */

import { API_VERSION } from '../api-version.js';
import type { BridgeClient } from '../capabilities/native.js';
import type { DebugHub } from '../log/debug-hub.js';
import type { LogSink } from '../log/log-sink.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import { buildBridgeCard } from './bridge-card.js';
import { badge, button, card, controlRow, description, grid, panelLayout, row, stat, toggle, value } from './widgets.js';

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
    // Both, and not just the bridge: the counts below are wrong for the life of the page
    // otherwise, because nothing is installed or enabled yet at the moment this first renders.
    if (this.#unsubscribe === undefined) {
      const offStatus = this.#deps.native.onStatus(() => { this.refresh(); });
      const offManager = this.#deps.manager.onChange(() => { this.refresh(); });
      this.#unsubscribe = () => { offStatus(); offManager(); };
    }
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
      grid([this.#buildStatus(), this.#buildPlatform(), this.#buildAbout()], 320, 2),
    );
  }

  #buildStatus(): HTMLElement {
    const panel = card('Status', 'info');
    const { manager, sink, debugHub } = this.#deps;
    const enabled = manager.compiled.filter((p) => manager.isEnabled(p.manifest.id)).length;
    // Installed but not in the bundle means installed since this page loaded, which is worth
    // pointing at: those plugins cannot run until VRCNext is restarted.
    const pending = manager.installed.length - manager.compiled.length;
    panel.appendChild(
      grid([
        stat('Installed', String(manager.installed.length)),
        stat('In this bundle', String(manager.compiled.length)),
        stat('Enabled', String(enabled), enabled === 0 ? 'warning' : 'ok'),
        stat('Log records', String(sink.records.length)),
      ], 92),
    );
    if (pending > 0) {
      panel.appendChild(description(`${String(pending)} installed plugin(s) are not in this bundle yet; restart VRCNext to run them.`));
    }
    panel.appendChild(row('Plugin API version', value(API_VERSION)));
    panel.appendChild(row('Page origin', value(globalThis.location.origin)));
    panel.appendChild(
      row(
        'Verbose debug logging',
        toggle(debugHub.enabled, (next) => { debugHub.enabled = next; }),
        'Writes debug lines from the host and from plugins — the picture a report chose, the payload a webhook is about to get — and mirrors console errors and UI interactions, into the host log and the bridge’s plugins.log.',
      ),
    );
    return panel;
  }

  #buildPlatform(): HTMLElement {
    const panel = card('Platform support', 'desktop_windows');
    const linux = this.#deps.isLinux();
    panel.appendChild(description(linux ? 'Running on Linux.' : 'Running on Windows.'));
    // A fresh element per row: a DOM node appended twice is *moved*, which silently emptied
    // whichever row asked for the bridge badge first.
    const bridge = (): HTMLElement =>
      this.#deps.native.status === 'connected' ? badge('ok', 'Via bridge') : badge('warn', 'Bridge not connected');
    for (const [label, badgeEl] of [
      // Windows-only in VRCNext, but the bridge holds the sockets itself where VRCNext will not.
      ['OSC', linux ? bridge() : badge('ok', 'Available')],
      ['Desktop notifications', linux ? bridge() : badge('ok', 'Available')],
      ['VR overlay notifications', bridge()],
      ['In-app toasts, modals', badge('ok', 'Available')],
      ['Host events, actions, game log', badge('ok', 'Available')],
      ['UI, context menus, routes', badge('ok', 'Available')],
    ] as const) {
      panel.appendChild(row(label, badgeEl));
    }
    return panel;
  }

  #buildAbout(): HTMLElement {
    const panel = card('About', 'extension');
    panel.appendChild(
      description(
        'A plugin runtime for VRCNext that installs as a custom theme and never modifies VRCNext ' +
          'itself. The VRCNext Bridge compiles the host and every installed plugin into one bundle; ' +
          'plugins run with the full authority of this page, so each capability is declared and ' +
          'each concrete use is confirmed the first time. Code only arrives from a repository ' +
          'signed by a key you have accepted, and only source the bridge could read and scan.',
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
