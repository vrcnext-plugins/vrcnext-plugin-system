/**
 * The "Plugin System" tab — host settings, status, and the things that fit nowhere else.
 *
 * Deliberately states what the host *cannot* do alongside what it can. A user reading this tab
 * should not have to discover the platform gates by watching a plugin silently do nothing.
 */

import type { Logger } from '@vrcnext/plugin-api';

import { API_VERSION } from '../api-version.js';
import type { NativeClient } from '../capabilities/native.js';
import type { LogSink } from '../log/log-sink.js';
import type { PluginManager } from '../plugin-manager.js';
import type { Updater } from '../update/updater.js';
import { CLASSES, element, iconSpan } from './dom.js';

const REPO_URL = 'https://github.com/vrcnext-plugins/vrcnext-plugin-system';
const DOCS_URL = 'https://vrcnext-plugins.github.io/';

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
    this.#root = container;
    this.refresh();
  }

  refresh(): void {
    const root = this.#root;
    if (root === undefined) return;
    root.replaceChildren(
      this.#buildStatus(),
      this.#buildUpdates(),
      this.#buildPlatform(),
      this.#buildCompanion(),
      AboutPanel.#buildAbout(this.#deps.openUrl),
    );
  }

  #buildStatus(): HTMLElement {
    const card = AboutPanel.#card('Status', 'info');
    const { manager, sink } = this.#deps;
    const enabled = manager.plugins.filter((p) => p.enabled).length;

    AboutPanel.#rows(card, [
      ['Plugin API version', API_VERSION],
      ['Repositories', String(manager.repos.length)],
      ['Plugins installed', String(manager.plugins.length)],
      ['Plugins enabled', String(enabled)],
      ['Log records held', String(sink.records.length)],
      ['Page origin', globalThis.location.origin],
    ]);
    return card;
  }

  #buildUpdates(): HTMLElement {
    const card = AboutPanel.#card('Updates', 'update');

    const note = AboutPanel.#note(
      'Plugins update automatically: every repository is re-read on boot and every six hours, ' +
        'and any plugin with a newer manifest version is re-downloaded and restarted. Settings ' +
        'are preserved. The host itself can only detect a new release — it is a file in ' +
        'VRCNext’s theme folder, and the page cannot write to disk.',
    );
    card.appendChild(note);

    const row = element('div', CLASSES.toggleRow);
    const status = element('div', undefined, 'Not checked yet.');
    const button = element('button', undefined, 'Check for updates now');

    button.addEventListener('click', () => {
      button.disabled = true;
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
          button.disabled = false;
        });
    });

    row.append(button, status);
    card.appendChild(row);
    return card;
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
        : `Updated ${report.updated.map((u) => u.name).join(', ')}.`,
    );
    if (report.hostUpdate !== undefined) {
      parts.push(`Plugin system ${report.hostUpdate} is available — re-run the installer.`);
    }
    if (report.failures.length > 0) parts.push(`${String(report.failures.length)} check(s) failed.`);
    return parts.join(' ');
  }

  #buildPlatform(): HTMLElement {
    const card = AboutPanel.#card('Platform support', 'desktop_windows');
    const linux = this.#deps.isLinux();

    card.appendChild(
      AboutPanel.#note(
        linux
          ? 'Running on Linux. VRCNext compiles several features out on this platform, so the ' +
              'capabilities below are unavailable to plugins no matter what they do.'
          : 'Running on Windows. All plugin capabilities are available.',
      ),
    );

    AboutPanel.#rows(card, [
      ['OSC', linux ? 'Unavailable — Windows only' : 'Available'],
      ['Desktop & VR notifications', linux ? 'Unavailable — Windows only' : 'Available'],
      ['In-app toasts, modals', 'Available'],
      ['Host events, bridge actions', 'Available'],
      ['Game log', 'Available'],
      ['UI, context menus, routes', 'Available'],
    ]);
    return card;
  }

  /**
   * The native companion's status.
   *
   * Rendered whether or not it is installed: a user wondering why a plugin's VR notifications do
   * nothing should find the answer here rather than in a log file.
   */
  #buildCompanion(): HTMLElement {
    const card = AboutPanel.#card('Native companion', 'hub');
    const { native } = this.#deps;

    card.appendChild(
      AboutPanel.#note(
        'vrcnext-bridge is an optional local daemon. It is the only way plugins can reach a VR ' +
          'overlay or the desktop notification daemon, because the page itself cannot open a UDP ' +
          'socket or talk to D-Bus. Without it, those targets are simply unavailable — nothing ' +
          'else stops working.',
      ),
    );

    const status = element('div', undefined, native.available ? 'Connected.' : 'Not running.');
    const targets = element('div');
    const refresh = element('button', undefined, 'Re-check');

    const update = (): void => {
      status.textContent = native.available ? 'Connected.' : 'Not running.';
      void native.targets().then((found) => {
        targets.replaceChildren();
        for (const target of found) {
          const row = element('div', CLASSES.toggleRow);
          row.appendChild(element('div', undefined, target.name));
          const detail = element('div', undefined, `${target.health} — ${target.description}`);
          detail.style.cssText = 'color:var(--tx2);';
          row.appendChild(detail);
          targets.appendChild(row);
        }
      });
    };

    refresh.addEventListener('click', () => {
      refresh.disabled = true;
      void native.probe().finally(() => {
        refresh.disabled = false;
        update();
      });
    });

    const row = element('div', CLASSES.toggleRow);
    row.append(refresh, status);
    card.append(row, targets);

    card.appendChild(this.#buildEndpointRow(update));
    update();
    return card;
  }

  /**
   * Lets the user point the host at a relocated daemon.
   *
   * The bridge's listen address is a flag, so pinning the host to one endpoint would strand anyone
   * who changed it — with no recourse short of editing the installed bundle.
   */
  #buildEndpointRow(onChange: () => void): HTMLElement {
    const { native } = this.#deps;
    const row = element('div', CLASSES.toggleRow);
    row.appendChild(element('div', undefined, 'Endpoint'));

    const input = document.createElement('input');
    input.type = 'text';
    input.value = native.endpoint;
    input.spellcheck = false;
    input.style.cssText = 'min-width:260px;text-align:right;';

    const apply = (): void => {
      if (input.value === native.endpoint) return;
      input.disabled = true;
      void native.setEndpoint(input.value).finally(() => {
        input.disabled = false;
        input.value = native.endpoint;
        onChange();
      });
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') apply();
    });

    row.appendChild(input);
    return row;
  }

  static #buildAbout(openUrl: (url: string) => void): HTMLElement {
    const card = AboutPanel.#card('About', 'extension');

    card.appendChild(
      AboutPanel.#note(
        'A plugin runtime for VRCNext that installs as a custom theme and never modifies ' +
          'VRCNext itself. Plugins run with the full authority of this page — your VRChat ' +
          'session, your webhooks, your settings. There is no sandbox, so only install ' +
          'repositories you trust.',
      ),
    );

    const row = element('div', CLASSES.toggleRow);
    for (const [label, url] of [
      ['Documentation', DOCS_URL],
      ['Source', REPO_URL],
    ] as const) {
      const button = element('button', undefined, label);
      button.addEventListener('click', () => { openUrl(url); });
      row.appendChild(button);
    }
    card.appendChild(row);

    card.appendChild(AboutPanel.#note('Released into the public domain under the Unlicense.'));
    return card;
  }

  static #card(title: string, icon: string): HTMLElement {
    const card = element('div', CLASSES.card);
    const header = element('div', CLASSES.cardHeader);
    header.appendChild(iconSpan(icon));
    header.appendChild(element('span', undefined, title));
    card.appendChild(header);
    return card;
  }

  static #rows(card: HTMLElement, rows: readonly (readonly [string, string])[]): void {
    for (const [label, value] of rows) {
      const row = element('div', CLASSES.toggleRow);
      row.appendChild(element('div', undefined, label));
      const valueEl = element('div', undefined, value);
      valueEl.style.cssText = 'color:var(--tx2);font-variant-numeric:tabular-nums;';
      row.appendChild(valueEl);
      card.appendChild(row);
    }
  }

  static #note(text: string): HTMLElement {
    const note = element('div', undefined, text);
    note.style.cssText =
      'font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:8px 0;line-height:1.5;';
    return note;
  }
}
