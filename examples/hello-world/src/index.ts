/**
 * Minimal VRCNext plugin.
 *
 * Demonstrates the four things every plugin has available: typed settings, the host event
 * stream, UI injection using VRCNext's own markup, and disposal.
 */

import { definePlugin, type PluginId, type SettingsSchema } from '@vrcnext/plugin-api';

const settings = {
  greetOnFriendOnline: {
    kind: 'boolean',
    label: 'Log a line when a friend comes online',
    description: 'Writes to the plugin log, not to VRChat.',
    default: true,
  },
  tone: {
    kind: 'select',
    label: 'Greeting tone',
    default: 'friendly',
    options: [
      { value: 'friendly', label: 'Friendly' },
      { value: 'terse', label: 'Terse' },
    ],
  },
} as const satisfies SettingsSchema;

export default definePlugin({
  id: 'hello-world' as PluginId,
  settings,

  activate(ctx) {
    ctx.logger.info(`Hello from v${ctx.version}.`);

    // `tone` is the literal union 'friendly' | 'terse', not a bare string.
    const greeting = ctx.settings.get('tone') === 'terse' ? 'Online:' : 'Welcome back,';

    ctx.events.on('friendTimelineEvent', (payload) => {
      if (!ctx.settings.get('greetOnFriendOnline')) return;
      if (payload.type !== 'online') return;
      ctx.logger.info(`${greeting} ${payload.friendName}`);
    });

    ctx.ui.addSettingsCard({
      title: 'Hello World',
      icon: 'back_hand',
      render: (card) => {
        card.appendChild(
          ctx.ui.createToggleRow(
            'Show a toast right now',
            false,
            (checked) => {
              if (checked) ctx.ui.toast({ message: 'Hello from a VRCNext plugin.' });
            },
          ),
        );
      },
    });
  },

  deactivate() {
    // Listeners and panels registered through `ctx` are torn down by the host; only
    // plugin-owned resources created outside it need cleaning up here.
  },
});
