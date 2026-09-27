/**
 * One installed plugin in the manager: identity, enable switch, update, uninstall, permissions.
 *
 * A plugin can be installed on the bridge but absent from this bundle (installed since the page
 * loaded), or the reverse (uninstalled since). Both are shown honestly with a "reload" badge
 * rather than hidden, so the user sees why the switch is greyed out.
 */

import type { PluginId, PluginManifest } from '@vrcnext/plugin-api';

import type { PermissionBroker } from '../permissions/broker.js';
import type { Grant } from '../permissions/types.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import type { InstalledPlugin, PluginUpdate } from '../plugins/plugins-service.js';
import { element } from './dom.js';
import { badge, button, card, controlRow, description, emptyState, row, sectionLabel, toggle, value } from './widgets.js';

export interface PluginCardDeps {
  readonly manager: PluginManager;
  readonly broker: PermissionBroker;
  /** Opens the plugin's settings card in VRCNext's Settings tab, when it has one. */
  readonly openSettings: (id: PluginId) => boolean;
  /** Runs an async action, reporting failure and redrawing afterwards. */
  readonly run: (work: () => Promise<unknown>) => void;
  /** Whether a changelog is expanded; survives redraws. */
  readonly openChangelogs: Set<string>;
}

export interface PluginView {
  readonly id: PluginId;
  readonly installed: InstalledPlugin | undefined;
  readonly manifest: PluginManifest | undefined;
  readonly update: PluginUpdate | undefined;
}

function titleLine(view: PluginView): HTMLElement {
  const name = view.installed?.name ?? view.manifest?.name ?? view.id;
  const version = view.installed?.version ?? view.manifest?.version ?? '';
  const tags = view.installed?.tags ?? view.manifest?.tags ?? [];
  const line = element('div');
  line.style.cssText = 'display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;';
  line.appendChild(element('span', undefined, name));
  if (version !== '') line.appendChild(value(`v${version}`));
  for (const tag of tags) line.appendChild(badge('neutral', tag));
  if (view.installed === undefined) line.appendChild(badge('warning', 'Removed — reload'));
  else if (view.manifest === undefined) line.appendChild(badge('warning', 'Reload to load'));
  return line;
}

function enableControl(view: PluginView, deps: PluginCardDeps): HTMLElement {
  const { manager } = deps;
  const enabled = manager.isEnabled(view.id);
  const control = element('div');
  control.style.cssText = 'display:flex;align-items:center;gap:10px;';
  control.appendChild(value(enabled ? (manager.isActive(view.id) ? 'Enabled' : 'Enabled, not running') : 'Disabled'));
  const sw = toggle(enabled, (next) => {
    deps.run(() => manager.setEnabled(view.id, next));
  });
  if (view.manifest === undefined) sw.querySelector('input')?.setAttribute('disabled', 'true');
  control.appendChild(sw);
  return control;
}

function updateSection(view: PluginView, deps: PluginCardDeps): HTMLElement | undefined {
  const update = view.update;
  if (update === undefined) return undefined;
  const box = element('div');
  const behind = `${String(update.commitsBehind)} commit${update.commitsBehind === 1 ? '' : 's'} behind`;
  box.appendChild(
    row(
      element('span', undefined, `Update available: ${update.current.slice(0, 7)} → ${update.latest.slice(0, 7)}`),
      controlRow(
        badge('accent', behind),
        button({
          label: 'Update',
          icon: 'system_update_alt',
          onClick: () => { deps.run(() => deps.manager.update(view.id)); },
        }),
      ),
    ),
  );
  const log = element('details');
  log.open = deps.openChangelogs.has(view.id);
  log.addEventListener('toggle', () => {
    if (log.open) deps.openChangelogs.add(view.id);
    else deps.openChangelogs.delete(view.id);
  });
  log.appendChild(element('summary', undefined, 'Changelog'));
  const pre = element('pre');
  pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:calc(11px + var(--fs-off, 0px));color:var(--tx2);';
  pre.textContent = update.changelog
    .map((entry) => `${entry.commit.slice(0, 7)}  ${entry.time}  ${entry.summary}`)
    .join('\n');
  log.appendChild(pre);
  box.appendChild(log);
  return box;
}

function grantLabel(grant: Grant): string {
  return grant.target === '*' ? grant.kind : `${grant.kind}: ${grant.target}`;
}

function permissionsSection(view: PluginView, deps: PluginCardDeps): HTMLElement {
  const box = element('div');
  box.appendChild(sectionLabel('Permissions'));
  const declared = view.manifest?.permissions ?? view.installed?.permissions ?? [];
  box.appendChild(
    description(
      declared.length === 0
        ? 'Declares no capabilities beyond its own UI.'
        : `May use: ${declared.join(', ')}. Saved answers to its runtime prompts are listed below.`,
    ),
  );
  const grants = deps.broker.savedGrants(view.id);
  if (grants.length === 0) {
    box.appendChild(emptyState('No saved grants.'));
    return box;
  }
  for (const grant of grants) {
    box.appendChild(
      row(
        grantLabel(grant),
        button({
          label: 'Revoke',
          icon: 'block',
          onClick: () => { deps.run(() => deps.broker.revoke(view.id, grant)); },
        }),
      ),
    );
  }
  box.appendChild(
    controlRow(
      button({
        label: 'Forget all',
        icon: 'delete_sweep',
        onClick: () => { deps.run(() => deps.broker.forgetAll(view.id)); },
      }),
    ),
  );
  return box;
}

export function buildPluginCard(view: PluginView, deps: PluginCardDeps): HTMLElement {
  const panel = card();
  const summary = view.installed?.description ?? view.manifest?.description ?? '';
  panel.appendChild(row(titleLine(view), enableControl(view, deps), summary === '' ? undefined : summary));

  const updates = updateSection(view, deps);
  if (updates !== undefined) panel.appendChild(updates);
  panel.appendChild(permissionsSection(view, deps));

  const actions = controlRow();
  if (view.installed !== undefined) {
    actions.appendChild(value(view.installed.url));
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
      button({
        label: 'Uninstall',
        icon: 'delete',
        onClick: () => { deps.run(() => deps.manager.uninstall(view.id)); },
      }),
    );
  }
  actions.style.marginTop = '8px';
  panel.appendChild(actions);
  return panel;
}
