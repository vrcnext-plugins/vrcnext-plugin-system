/**
 * Your plugin.
 *
 * `main.ts` at the repository root default-exports one `definePlugin({...})`. The host calls
 * `activate` when the user enables the plugin and tears down everything registered through
 * `ctx` when it is disabled; `deactivate` is for resources created outside `ctx`.
 *
 * Reach the outside world only through `ctx.*`. The bridge refuses to install a plugin whose
 * source touches `window`, `globalThis`, `fetch`, `localStorage`, `eval` and similar (see the
 * README), and every gated capability must be declared in `plugin.json`.
 */

import { definePlugin, type PluginId, type SettingsSchema } from '@vrcnext/plugin-api';

const settings = {
  enabled: {
    kind: 'boolean',
    label: 'Do the thing',
    description: 'Rendered as a switch on VRCNext’s settings page.',
    default: true,
  },
} as const satisfies SettingsSchema;

export default definePlugin({
  // Must equal "id" in plugin.json.
  id: 'my-plugin' as PluginId,
  settings,

  activate(ctx) {
    ctx.logger.info(`v${ctx.version} activated.`);

    ctx.ui.addSettingsCard({
      title: 'My Plugin',
      icon: 'extension',
      render: (card) => {
        card.appendChild(ctx.ui.kit.description('Settings above come from the schema in main.ts.'));
      },
    });

    // Add "host:events" to plugin.json permissions and the event name to "events" before
    // uncommenting; an undeclared category is refused, an undeclared event prompts the user.
    // ctx.events.on('friendTimelineEvent', (payload) => { ctx.logger.info(payload.friendName); });
  },

  deactivate() {
    // Everything registered through ctx is torn down by the host.
  },
});
