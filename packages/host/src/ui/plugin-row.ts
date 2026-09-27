/**
 * One installed plugin, as a row that opens.
 *
 * The closed row is what a user scans: name, version, what it is, and the switch. Everything
 * that is only interesting when you are asking a question about one plugin — where it came
 * from, what it may do, what you have already allowed it, which commits it is behind — is
 * inside. A plugin can also be installed on the bridge but absent from this bundle (installed
 * since the page loaded), or the reverse; both are stated rather than hidden, so the greyed
 * switch has a visible reason.
 */

import { permissionInfo, type Permission, type PluginId, type PluginManifest } from '@vrcnext/plugin-api';

import type { PermissionBroker } from '../permissions/broker.js';
import type { Grant } from '../permissions/types.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import type { InstalledPlugin, PluginUpdate } from '../plugins/plugins-service.js';
import { element, iconSpan } from './dom.js';
import { badge, button, chip, description, emptyState, row, sectionLabel, toggle, value } from './widgets.js';

export interface PluginRowDeps {
  readonly manager: PluginManager;
  readonly broker: PermissionBroker;
  /** Opens the plugin's settings card in VRCNext's Settings tab, when it has one. */
  readonly openSettings: (id: PluginId) => boolean;
  /** Runs an async action, reporting failure and redrawing afterwards. */
  readonly run: (work: () => Promise<unknown>) => void;
  readonly openUrl: (url: string) => void;
  /** Which rows are expanded; survives redraws. */
  readonly expanded: Set<string>;
  /** Whether a changelog is expanded; survives redraws. */
  readonly openChangelogs: Set<string>;
}

export interface PluginView {
  readonly id: PluginId;
  readonly installed: InstalledPlugin | undefined;
  readonly manifest: PluginManifest | undefined;
  readonly update: PluginUpdate | undefined;
}

function nameOf(view: PluginView): string {
  return view.installed?.name ?? view.manifest?.name ?? view.id;
}

/** The one badge that says the most about this plugin's current state. */
function stateBadge(view: PluginView, manager: PluginManager): HTMLElement {
  if (view.installed === undefined) return badge('warning', 'Removed — reload');
  if (view.manifest === undefined) return badge('warning', 'Reload to load');
  if (!manager.isEnabled(view.id)) return badge('neutral', 'Disabled');
  if (!manager.isActive(view.id)) return badge('warning', 'Not running');
  if (view.update !== undefined) return badge('accent', 'Update');
  return badge('ok', 'Running');
}

/** A control inside a `<summary>`: its clicks must not fold the row. */
function keepOpen<T extends HTMLElement>(node: T): T {
  node.addEventListener('click', (event) => { event.stopPropagation(); });
  return node;
}

function summaryLine(view: PluginView, deps: PluginRowDeps): HTMLElement {
  const summary = element('summary', 'vrcnx-plugin-summary');
  summary.appendChild(iconSpan('extension'));

  const text = element('div', 'vrcnx-plugin-text');
  const title = element('div', 'vrcnx-plugin-name');
  title.appendChild(element('span', undefined, nameOf(view)));
  const version = view.installed?.version ?? view.manifest?.version ?? '';
  if (version !== '') title.appendChild(value(`v${version}`));
  title.appendChild(stateBadge(view, deps.manager));
  text.appendChild(title);

  const blurb = view.installed?.description ?? view.manifest?.description ?? '';
  if (blurb !== '') text.appendChild(element('div', 'set-desc vrcnx-plugin-blurb', blurb));
  summary.appendChild(text);

  const sw = toggle(deps.manager.isEnabled(view.id), (next) => {
    deps.run(() => deps.manager.setEnabled(view.id, next));
  });
  if (view.manifest === undefined) sw.querySelector('input')?.setAttribute('disabled', 'true');
  summary.appendChild(keepOpen(sw));
  return summary;
}

function sourceRow(view: PluginView, deps: PluginRowDeps): HTMLElement | undefined {
  const url = view.installed?.url;
  if (url === undefined) return undefined;
  return row(
    'Source',
    button({ label: 'Open', icon: 'open_in_new', onClick: () => { deps.openUrl(url); } }),
    url,
  );
}

function updateRows(view: PluginView, deps: PluginRowDeps): readonly HTMLElement[] {
  const update = view.update;
  if (update === undefined) return [];
  const behind = `${String(update.commitsBehind)} commit${update.commitsBehind === 1 ? '' : 's'} behind`;
  const head = row(
    'Update available',
    button({
      label: 'Update',
      icon: 'system_update_alt',
      onClick: () => { deps.run(() => deps.manager.update(view.id)); },
    }),
    `${update.current.slice(0, 7)} → ${update.latest.slice(0, 7)} · ${behind}`,
  );

  const log = element('details', 'vrcnx-changelog');
  log.open = deps.openChangelogs.has(view.id);
  log.addEventListener('toggle', () => {
    if (log.open) deps.openChangelogs.add(view.id);
    else deps.openChangelogs.delete(view.id);
  });
  log.appendChild(element('summary', 'set-desc', 'Changelog'));
  const pre = element('pre');
  pre.textContent = update.changelog
    .map((entry) => `${entry.commit.slice(0, 7)}  ${entry.time}  ${entry.summary}`)
    .join('\n');
  log.appendChild(pre);
  return [head, log];
}

const TONE_CLASS = { low: 'ok', medium: 'warning', high: 'err' } as const;

function grantLabel(grant: Grant): string {
  return grant.target === '*' ? grant.kind : `${grant.kind}: ${grant.target}`;
}

/** Declared categories as tone-coloured chips, then the answers already saved, each removable. */
function permissionsBlock(view: PluginView, deps: PluginRowDeps): DocumentFragment {
  const block = document.createDocumentFragment();
  block.appendChild(sectionLabel('May use'));
  // An installed plugin's list comes back from the bridge as plain strings; the manifest's is
  // already narrowed. Both were validated against the vocabulary before they got here.
  const declared = (view.manifest?.permissions ?? view.installed?.permissions ?? []) as readonly Permission[];
  if (declared.length === 0) {
    block.appendChild(description('Nothing beyond its own UI and settings.'));
  } else {
    const strip = element('div', 'vrcnx-chips vrcnx-chips-left');
    for (const name of declared) {
      strip.appendChild(badge(TONE_CLASS[permissionInfo(name).tone], name));
    }
    block.appendChild(strip);
  }

  block.appendChild(sectionLabel('Allowed so far'));
  const grants = deps.broker.savedGrants(view.id);
  if (grants.length === 0) {
    block.appendChild(description('Nothing saved. You are asked the first time it tries.'));
    return block;
  }
  const strip = element('div', 'vrcnx-chips vrcnx-chips-left');
  for (const grant of grants) {
    strip.appendChild(chip(grantLabel(grant), () => { deps.run(() => deps.broker.revoke(view.id, grant)); }));
  }
  strip.appendChild(
    button({ label: 'Forget all', icon: 'delete_sweep', onClick: () => { deps.run(() => deps.broker.forgetAll(view.id)); } }),
  );
  block.appendChild(strip);
  return block;
}

function actionRow(view: PluginView, deps: PluginRowDeps): HTMLElement {
  const actions = element('div', 'vrcnx-chips vrcnx-chips-left');
  if (view.installed === undefined) return actions;
  if (deps.manager.isActive(view.id)) {
    actions.appendChild(
      button({
        label: 'Settings',
        icon: 'tune',
        onClick: () => {
          if (!deps.openSettings(view.id)) deps.run(() => Promise.reject(new Error('This plugin has no settings card.')));
        },
      }),
    );
  }
  actions.appendChild(
    button({ label: 'Uninstall', icon: 'delete', onClick: () => { deps.run(() => deps.manager.uninstall(view.id)); } }),
  );
  return actions;
}

export function buildPluginRow(view: PluginView, deps: PluginRowDeps): HTMLElement {
  const root = element('details', 'vrcnx-plugin-row');
  root.open = deps.expanded.has(view.id);
  root.addEventListener('toggle', () => {
    if (root.open) deps.expanded.add(view.id);
    else deps.expanded.delete(view.id);
  });
  root.appendChild(summaryLine(view, deps));

  const body = element('div', 'vrcnx-plugin-body');
  for (const node of updateRows(view, deps)) body.appendChild(node);
  const source = sourceRow(view, deps);
  if (source !== undefined) body.appendChild(source);
  if (view.manifest === undefined && view.installed !== undefined) {
    body.appendChild(description('Installed, but not in the bundle this page loaded. Reload VRCNext to run it.'));
  }
  body.appendChild(permissionsBlock(view, deps));
  body.appendChild(actionRow(view, deps));
  root.appendChild(body);
  return root;
}

/** The list of rows, or the empty state. */
export function buildPluginRows(views: readonly PluginView[], deps: PluginRowDeps): HTMLElement {
  const list = element('div', 'vrcnx-plugin-list');
  if (views.length === 0) {
    list.appendChild(emptyState('No plugins yet. Install one above.'));
    return list;
  }
  for (const view of views) list.appendChild(buildPluginRow(view, deps));
  return list;
}
