/**
 * The "Plugin System" tab — host status, the bridge, and what fits nowhere else.
 *
 * Built entirely from {@link widgets}, which are VRCNext's own markup. Nothing here invents a
 * style; the tab should be indistinguishable from a built-in settings section.
 *
 * It deliberately states what the host *cannot* do alongside what it can. A user should not have
 * to discover the platform gates by watching a plugin silently do nothing.
 */

import type { Logger, NativeStatus } from '@vrcnext/plugin-api';

import { API_VERSION } from '../api-version.js';
import type { NativeClient } from '../capabilities/native.js';
import type { DebugHub } from '../log/debug-hub.js';
import type { LogSink } from '../log/log-sink.js';
import type { PluginManager } from '../plugin-manager.js';
import type { Updater } from '../update/updater.js';
import { element } from './dom.js';
import {
  badge,
  button,
  card,
  controlRow,
  description,
  grid,
  panelLayout,
  row,
  sectionLabel,
  statusCard,
  textField,
  toggle,
  value,
  type StatusTone,
} from './widgets.js';

const REPO_URL = 'https://github.com/vrcnext-plugins/vrcnext-plugin-system';
const DOCS_URL = 'https://vrcnext-plugins.github.io/';
const BRIDGE_URL = 'https://github.com/vrcnext-plugins/vrcnext-bridge';

export interface AboutPanelDeps {
  readonly manager: PluginManager;
  readonly updater: Updater;
  readonly sink: LogSink;
  readonly logger: Logger;
  readonly native: NativeClient;
  readonly debugHub: DebugHub;
  readonly isLinux: () => boolean;
  readonly openUrl: (url: string) => void;
}

/** One vocabulary for the bridge's state, shared by every card that shows it. */
const BRIDGE_STATE: Readonly<Record<NativeStatus, { tone: StatusTone; label: string }>> = {
  not_detected: { tone: 'offline', label: 'Not detected' },
  running_not_connected: { tone: 'warn', label: 'Running, not connected' },
  connected: { tone: 'online', label: 'Connected' },
};

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
    // The socket connects on its own schedule, so the cards follow it rather than the user
    // having to press Re-check to see the dot turn green.
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
    // Paired by content type, two columns at most, in a deliberate order — not dropped into an
    // auto-fit grid and left to pack itself.
    //
    // A three-column auto-fit produced orphan cells (five cards do not divide into three) and
    // squeezed four paragraphs of prose into ~300px columns. Here the two compact key/value cards
    // share row one, the bridge owns row two because its target rows and endpoint field use the
    // width, and the two prose cards share row three at a readable measure.
    const companion = this.#buildBridge();
    companion.classList.add('vrcnx-full');

    root.replaceChildren(
      grid(
        [
          this.#buildStatus(),
          this.#buildPlatform(),
          companion,
          this.#buildDiagnostics(),
          this.#buildUpdates(),
          this.#buildAbout(),
        ],
        // Wide enough that the grid can only ever resolve to two columns, then one.
        460,
      ),
    );
  }

  #buildStatus(): HTMLElement {
    const panel = card('Status', 'info');
    const { manager, sink } = this.#deps;
    const enabled = manager.plugins.filter((plugin) => plugin.enabled).length;

    for (const [label, text] of [
      ['Plugin API version', API_VERSION],
      ['Repositories', String(manager.repos.length)],
      ['Plugins installed', String(manager.plugins.length)],
      ['Plugins enabled', String(enabled)],
      ['Log records held', String(sink.records.length)],
      ['Page origin', globalThis.location.origin],
    ] as const) {
      panel.appendChild(row(label, value(text)));
    }
    return panel;
  }

  /**
   * The bridge.
   *
   * Rendered whether or not it is installed: a user wondering why a plugin's VR notifications do
   * nothing should find the answer here rather than in a log file.
   */
  #buildBridge(): HTMLElement {
    const { native } = this.#deps;
    const panel = card('VRCNext Bridge', 'hub');

    panel.appendChild(
      description(
        'The bridge is an optional native companion daemon. It is the only way plugins can reach ' +
        'a VR overlay or the desktop notification daemon, because the page itself cannot open a ' +
        'UDP socket or talk to D-Bus. Without it those targets are unavailable — nothing else ' +
        'stops working. Yellow means it answered a health check but the socket is not open; it ' +
        'may have been stopped since. The page cannot tell "not installed" from "not started".',
      ),
    );

    const state = BRIDGE_STATE[native.status];
    panel.appendChild(
      statusCard({
        tone: state.tone,
        label: state.label,
        action: button({
          label: 'Re-check',
          icon: 'refresh',
          onClick: () => { void native.probe().then(() => { this.refresh(); }); },
        }),
      }),
    );

    const targets = element('div');
    if (native.status === 'connected') {
      void native.targets().then((found) => {
        targets.replaceChildren();
        if (found.length === 0) {
          targets.appendChild(description('No targets configured.'));
          return;
        }
        targets.appendChild(sectionLabel('Targets'));
        for (const target of found) {
          const tone = target.health === 'up' ? 'ok' : target.health === 'down' ? 'err' : 'neutral';
          targets.appendChild(row(target.name, badge(tone, target.health), target.description));
        }
      });
    }

    panel.append(targets, sectionLabel('Endpoint'));
    panel.appendChild(
      controlRow(
        textField({
          value: native.endpoint,
          placeholder: 'http://127.0.0.1:42081',
          onCommit: (next) => {
            void native.setEndpoint(next).then(() => { this.refresh(); });
          },
        }),
        button({
          label: 'Get the daemon',
          icon: 'open_in_new',
          onClick: () => { this.#deps.openUrl(BRIDGE_URL); },
        }),
      ),
    );

    return panel;
  }

  #buildUpdates(): HTMLElement {
    const panel = card('Updates', 'system_update_alt');

    panel.appendChild(
      description(
        'Plugins update automatically: every repository is re-read on boot and every six hours, ' +
        'and any plugin with a newer manifest version is re-downloaded and restarted. Settings ' +
        'are preserved. The host itself can only detect a new release — it is a file in ' +
        'VRCNext’s theme folder, and the page cannot write to disk.',
      ),
    );

    const status = value('Not checked yet.');
    const check = button({
      label: 'Check for updates now',
      icon: 'refresh',
      onClick: () => {
        check.disabled = true;
        status.textContent = 'Checking…';
        void this.#deps.updater
          .check()
          .then((report) => {
            status.textContent = AboutPanel.#summarise(report);
            this.#deps.logger.info(`Manual update check: ${status.textContent}`);
          })
          .catch((error: unknown) => {
            status.textContent = error instanceof Error ? error.message : String(error);
          })
          .finally(() => {
            check.disabled = false;
          });
      },
    });

    panel.appendChild(controlRow(check, status));
    return panel;
  }

  static #summarise(report: {
    readonly updated: readonly { readonly name: string }[];
    readonly failures: readonly string[];
    readonly hostUpdate: string | undefined;
  }): string {
    const parts: string[] = [];
    parts.push(
      report.updated.length === 0
        ? 'All plugins are up to date.'
        : `Updated ${report.updated.map((update) => update.name).join(', ')}.`,
    );
    if (report.hostUpdate !== undefined) {
      parts.push(`Plugin system ${report.hostUpdate} is available — re-run the installer.`);
    }
    if (report.failures.length > 0) parts.push(`${String(report.failures.length)} check(s) failed.`);
    return parts.join(' ');
  }

  #buildPlatform(): HTMLElement {
    const panel = card('Platform support', 'desktop_windows');
    const linux = this.#deps.isLinux();
    const { native } = this.#deps;

    panel.appendChild(
      description(linux ? 'Running on Linux.' : 'Running on Windows.'),
    );

    // Anything only the bridge can do is coloured by the bridge's state, so this card answers
    // "why does my VR notification do nothing" without a trip to the bridge card below.
    const viaBridge = (): HTMLElement => {
      const state = BRIDGE_STATE[native.status];
      const tone = state.tone === 'online' ? 'ok' : state.tone === 'warn' ? 'warn' : 'neutral';
      return badge(tone, `Bridge: ${state.label.toLowerCase()}`);
    };

    for (const [label, badgeEl] of [
      ['OSC', !linux ? badge('ok', 'Available') : badge('warn', 'Windows only')],
      ['Desktop notifications', !linux ? badge('ok', 'Available') : viaBridge()],
      ['VR overlay notifications', viaBridge()],
      ['In-app toasts, modals', badge('ok', 'Available')],
      ['Host events, bridge actions', badge('ok', 'Available')],
      ['Game log', badge('ok', 'Available')],
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
        'A plugin runtime for VRCNext that installs as a custom theme and never modifies ' +
        'VRCNext itself. Plugins run with the full authority of this page — your VRChat ' +
        'session, your webhooks, your settings. There is no sandbox, so only install ' +
        'repositories you trust.',
      ),
    );

    panel.appendChild(
      controlRow(
        button({
          label: 'Documentation',
          icon: 'description',
          onClick: () => { this.#deps.openUrl(DOCS_URL); },
        }),
        button({
          label: 'Source',
          icon: 'terminal',
          onClick: () => { this.#deps.openUrl(REPO_URL); },
        }),
      ),
    );

    panel.appendChild(description('Released into the public domain under the Unlicense.'));
    return panel;
  }

  #buildDiagnostics(): HTMLElement {
    const panel = card('Diagnostics', 'bug_report');
    panel.appendChild(
      description(
        'Developer diagnostics and tracing. When enabled, browser console errors and warnings ' +
        'are mirrored into the host log stream, and UI interaction events are recorded.',
      ),
    );
    panel.appendChild(
      row(
        'Verbose debug logging',
        toggle(this.#deps.debugHub.enabled, (next) => {
          this.#deps.debugHub.enabled = next;
        }),
      ),
    );
    return panel;
  }
}
