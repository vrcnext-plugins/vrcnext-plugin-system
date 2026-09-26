/**
 * The consent shown when a plugin is enabled: every category it may ever use, with its
 * description and risk tone, and the hosts, actions and events it pre-declares. Those targets
 * are granted at enable; anything else the plugin reaches for is asked about at the time.
 */

import { permissionInfo, type PermissionTone, type PluginManifest } from '@vrcnext/plugin-api';

import type { EnableConsent } from '../plugins/plugin-manager.js';
import { element } from './dom.js';
import { showModal } from './modal.js';
import { badge, description, emptyState, row, sectionLabel } from './widgets.js';

const TONE: Readonly<Record<PermissionTone, 'ok' | 'warning' | 'err'>> = {
  low: 'ok',
  medium: 'warning',
  high: 'err',
};

function targetList(label: string, items: readonly string[]): HTMLElement | undefined {
  if (items.length === 0) return undefined;
  const box = element('div');
  box.appendChild(sectionLabel(label));
  box.appendChild(element('pre', undefined, items.join('\n')));
  return box;
}

export class EnableModal implements EnableConsent {
  ask(manifest: PluginManifest): Promise<boolean> {
    const categories = manifest.permissions.map((permission) => {
      const info = permissionInfo(permission);
      return row(permission, badge(TONE[info.tone], info.tone), info.description);
    });
    return showModal<boolean>({
      title: `Enable ${manifest.name}?`,
      icon: 'extension',
      body: [
        description(
          `${manifest.name} v${manifest.version} — ${manifest.description || 'no description.'} ` +
            'It runs with the authority of this page; there is no sandbox. It may use these ' +
            'capabilities, and will ask the first time it touches anything not listed below.',
        ),
        sectionLabel('Capabilities'),
        ...(categories.length > 0 ? categories : [emptyState('None: this plugin only draws its own UI.')]),
        targetList('Hosts it may fetch', manifest.hosts),
        targetList('VRCNext actions it may call', manifest.actions),
        targetList('VRCNext events it may listen to', manifest.events),
        manifest.optionalPermissions.length > 0
          ? description(`May ask later for: ${manifest.optionalPermissions.join(', ')}.`)
          : undefined,
      ],
      buttons: [
        { label: 'Enable', icon: 'check', value: true },
        { label: 'Cancel', icon: 'close', value: false },
      ],
    });
  }
}
