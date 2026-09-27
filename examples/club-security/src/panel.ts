/**
 * The plugin's sidebar tab: status, the last reports, and two maintenance buttons.
 * Built from `ctx.ui.kit` so it is VRCNext's own markup and follows its theme.
 */

import type { PluginContext } from '@vrcnext/plugin-api';

import { describeFilter, filterFrom, instanceMatches } from './filters.js';
import { reportLines, type Report } from './notify.js';
import type { Settings } from './settings.js';
import type { CurrentInstance } from './vrcnext-data.js';

type Ctx = PluginContext<Settings>;

const MAX_SHOWN = 25;

export interface PanelDeps {
  readonly currentInstance: () => CurrentInstance | undefined;
  readonly sendTest: () => Promise<void>;
}

export class ReportPanel {
  readonly #ctx: Ctx;
  readonly #deps: PanelDeps;
  readonly #reports: Report[] = [];
  #status: HTMLElement | undefined;
  #list: HTMLElement | undefined;

  constructor(ctx: Ctx, deps: PanelDeps) {
    this.#ctx = ctx;
    this.#deps = deps;
  }

  install(): void {
    this.#ctx.ui.addNavTab({
      label: 'Club Security',
      icon: 'security',
      render: (tab) => { this.#render(tab); },
    });
    // The host renders every schema setting as a row on this card before `render` runs.
    this.#ctx.ui.addSettingsCard({
      title: 'Club Security',
      icon: 'security',
      render: (card) => {
        card.appendChild(this.#ctx.ui.kit.description(
          'Reports go out for joins in instances that pass every filter above. Test them from the Club Security tab.',
        ));
      },
    });
    this.#ctx.settings.onChange(() => { this.refresh(); });
  }

  push(report: Report): void {
    this.#reports.unshift(report);
    if (this.#reports.length > MAX_SHOWN) this.#reports.length = MAX_SHOWN;
    this.refresh();
  }

  refresh(): void {
    const k = this.#ctx.ui.kit;
    if (this.#status !== undefined) k.setChildren(this.#status, this.#statusRows());
    if (this.#list !== undefined) k.setChildren(this.#list, this.#reportRows());
  }

  #render(tab: HTMLElement): void {
    const k = this.#ctx.ui.kit;
    this.#status = k.card({ title: 'Status', icon: 'shield' });
    this.#list = k.card({ title: 'Recent reports', icon: 'history' });
    const actions = k.card({
      title: 'Actions',
      icon: 'build',
      children: [
        k.description('A test report uses the current instance and your own name, and goes to every enabled channel.'),
        k.description('Rejoin is answered from VRCNext’s own timeline: was this player in this exact instance with you before.'),
        k.buttonRow(
          k.button({ label: 'Send test notification', icon: 'send', onClick: () => { void this.#deps.sendTest(); } }),
        ),
      ],
    });
    tab.append(k.layout(k.pair(this.#status, actions), this.#list));
    this.refresh();
  }

  #statusRows(): readonly (HTMLElement | DocumentFragment)[] {
    const k = this.#ctx.ui.kit;
    const values = this.#ctx.settings.values;
    const filter = filterFrom(values);
    const instance = this.#deps.currentInstance();
    const matches = instance !== undefined && instanceMatches(filter, instance);
    const channels = [
      values.notifyToast && 'toast',
      values.notifyDesktop && 'desktop',
      values.notifyVr && 'VR',
      values.notifyDiscord && 'Discord',
    ].filter((c): c is string => typeof c === 'string');
    return [
      k.row({ label: 'Reporting', value: values.enabled ? k.badge('ok', 'On') : k.badge('neutral', 'Off') }),
      k.row({ label: 'Watching', detail: describeFilter(filter) }),
      k.row({
        label: 'Current instance',
        detail: instance === undefined ? 'Not in an instance' : `${instance.worldName} · ${instance.instanceType}`,
        value: instance === undefined ? undefined : k.badge(matches ? 'ok' : 'neutral', matches ? 'Matches' : 'Filtered out'),
      }),
      k.row({ label: 'Channels', detail: channels.length === 0 ? 'none enabled' : channels.join(', ') }),
    ];
  }

  #reportRows(): readonly (HTMLElement | DocumentFragment)[] {
    const k = this.#ctx.ui.kit;
    if (this.#reports.length === 0) return [k.emptyState('No joins reported yet.')];
    return this.#reports.map((report) => {
      const lines = reportLines(report, this.#ctx.settings.values.template);
      const time = new Date(report.at).toLocaleTimeString();
      return k.row({
        label: `${time} · ${report.joiner.name}`,
        detail: lines.slice(1).join(' · '),
        value: report.facts.rejoin.seenHere === true ? k.badge('warn', 'Rejoin') : k.badge('accent', report.facts.rejoin.seenHere === false ? 'New' : 'Rejoin ?'),
      });
    });
  }

}
