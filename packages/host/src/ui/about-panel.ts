/**
 * The "Plugin System" tab — host status, the native companion, and what fits nowhere else.
 *
 * Built entirely from {@link widgets}, which are VRCNext's own markup. Nothing here invents a
 * style; the tab should be indistinguishable from a built-in settings section.
 *
 * It deliberately states what the host *cannot* do alongside what it can. A user should not have
 * to discover the platform gates by watching a plugin silently do nothing.
 */

import type { Logger } from '@vrcnext/plugin-api';

import { API_VERSION } from '../api-version.js';
import type { NativeClient } from '../capabilities/native.js';
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
  value,
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
  readonly isLinux: () => boolean;
  readonly openUrl: (url: string) => void;
}

export class AboutPanel {
  readonly #deps: AboutPanelDeps;
  #root: HTMLElement | undefined;

  constructor(deps: AboutPanelDeps) {
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
    // A grid, not a stack: these cards are mostly short key/value lists, and full-width rows
    // across a maximised window leave a metre of empty space between label and value.
    const companion = this.#buildCompanion();
    companion.style.gridColumn = 'span 2';

    root.replaceChildren(
      grid([
        this.#buildStatus(),
        this.#buildPlatform(),
        companion,
        this.#buildUpdates(),
        this.#buildAbout(),
      ], 340),
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
   * The native companion.
   *
   * Rendered whether or not it is installed: a user wondering why a plugin's VR notifications do
   * nothing should find the answer here rather than in a log file.
   */
  #buildCompanion(): HTMLElement {
    const { native } = this.#deps;
    const panel = card('Native companion', 'hub');

    panel.appendChild(
      description(
        'vrcnext-bridge is an optional local daemon. It is the only way plugins can reach a VR ' +
          'overlay or the desktop notification daemon, because the page itself cannot open a UDP ' +
          'socket or talk to D-Bus. Without it those targets are unavailable — nothing else stops ' +
          'working.',
      ),
    );

    const status = element('div');
    const targets = element('div');

    const paint = (): void => {
      status.replaceChildren(
        statusCard({
          online: native.available,
          label: native.available ? 'Connected' : 'Not running',
          action: button({
            label: 'Re-check',
            icon: 'refresh',
            onClick: () => { void native.probe().then(paint); },
          }),
        }),
      );

      void native.targets().then((found) => {
        targets.replaceChildren();
        if (found.length === 0) {
          if (native.available) targets.appendChild(description('No targets configured.'));
          return;
        }
        targets.appendChild(sectionLabel('Targets'));
        for (const target of found) {
          const tone = target.health === 'up' ? 'ok' : target.health === 'down' ? 'err' : 'hidden';
          targets.appendChild(
            row(target.name, badge(tone === 'hidden' ? 'neutral' : tone, target.health), target.description),
          );
        }
      });
    };

    panel.append(status, targets, sectionLabel('Endpoint'));
    panel.appendChild(
      controlRow(
        textField({
          value: native.endpoint,
          placeholder: 'http://127.0.0.1:42081',
          onCommit: (next) => { void native.setEndpoint(next).then(paint); },
        }),
        button({
          label: 'Get the daemon',
          icon: 'open_in_new',
          onClick: () => { this.#deps.openUrl(BRIDGE_URL); },
        }),
      ),
    );

    paint();
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

    panel.appendChild(
      description(
        linux
          ? 'Running on Linux. VRCNext compiles several features out on this platform, so the ' +
              'capabilities below are unavailable to plugins no matter what they do. The native ' +
              'companion above is a separate process and is not subject to those gates.'
          : 'Running on Windows. All plugin capabilities are available.',
      ),
    );

    for (const [label, available] of [
      ['OSC', !linux],
      ['Desktop & VR notifications', !linux],
      ['In-app toasts, modals', true],
      ['Host events, bridge actions', true],
      ['Game log', true],
      ['UI, context menus, routes', true],
    ] as const) {
      panel.appendChild(
        row(
          label,
          available ? badge('ok', 'Available') : badge('warn', 'Windows only'),
        ),
      );
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
}
