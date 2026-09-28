/**
 * A Settings section of the plugin's own, after a divider, plus sidebar shortcuts to it.
 *
 * This is the same mechanism the host uses for its own Plugin System and Plugins pages — there
 * is no private path — and everything added here is removed again when the plugin is disabled.
 */

import type { Ctx, State } from '../state.js';

export function installSettingsSection(ctx: Ctx, state: State): void {
  const k = ctx.ui.kit;
  ctx.ui.addSettingsDivider();
  const section = ctx.ui.addSettingsSection({ id: 'counters', label: 'Example Plugin', icon: 'auto_awesome' });

  section.attach(
    k.card({
      title: 'Counters',
      icon: 'monitoring',
      children: [
        k.row({ label: 'Game log events', value: String(state.gameLogCount) }),
        k.row({ label: 'OSC parameters', value: String(state.oscParamCount) }),
        k.description('A section of the plugin’s own in VRCNext’s Settings tab. Cards here are ordinary cards.'),
      ],
    }),
  );

  // A settings card can be filed under the plugin's own section instead of the host's Plugins one.
  ctx.ui.addSettingsCard({ title: 'Example Plugin (mirror)', icon: 'auto_awesome', section });

  ctx.ui.addSidebarGroup({
    id: 'shortcuts',
    label: 'Example Plugin',
    icon: 'auto_awesome',
    entries: [
      {
        id: 'counters',
        label: 'Counters',
        icon: 'monitoring',
        activate: () => {
          section.open();
        },
      },
      {
        id: 'toast',
        label: 'Say hi',
        icon: 'waving_hand',
        activate: () => {
          ctx.ui.toast({ message: 'Hi from a shortcut.' });
        },
      },
    ],
  });
}
