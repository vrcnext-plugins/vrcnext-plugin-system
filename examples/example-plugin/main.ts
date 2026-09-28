/**
 * The VRCNext example plugin: a working starting point, and a reference for every capability.
 *
 * ## Making this yours
 *
 * 1. Change `id`, `name`, `description`, `author` and `homepage` in `plugin.json`, and `id`
 *    below to match — the host refuses to activate a plugin whose two ids disagree.
 * 2. **Delete the sections you do not need.** Each `install*` call below is one file under
 *    `src/sections/`; remove the line, remove the file, and remove whatever it needed from
 *    `permissions`, `events` and `hosts` in `plugin.json`. Declaring less is the point: every
 *    category is shown to the user with a risk tone when they enable the plugin.
 * 3. Trim `src/settings.ts` to the settings you actually have. It currently demonstrates every
 *    kind the host can render, which is far more than any real plugin wants.
 * 4. Sign it before pushing — `node scripts/sign-plugin.mjs`; see the README. The bridge will
 *    not install an unsigned repository.
 *
 * ## The shape of a plugin
 *
 * `main.ts` at the repository root default-exports one `definePlugin({...})`. `activate` runs
 * when the user enables the plugin; everything registered through `ctx` — listeners, panels,
 * routes, timers added to `ctx.disposables` — is torn down again when they disable it, and
 * `ctx.signal` aborts at the same moment. `deactivate` is only for resources created outside
 * `ctx`, which is why it is empty here.
 *
 * Reach the outside world **only** through `ctx.*`. The bridge refuses to install source that
 * reaches for the page's globals, storage, sockets or a string evaluator directly, and refuses
 * source that has been minified or obfuscated so that check could not work. The README lists
 * every rule — and note that the scan reads comments too, which is why this one names none of
 * the forbidden spellings.
 */

import { definePlugin, type PluginId } from '@vrcnext/plugin-api';

import { settings } from './src/settings.js';
import { createState } from './src/state.js';
import { PLUGIN_CSS } from './src/styles.js';
import { installContextMenu } from './src/sections/context-menu.js';
import { installDeepLinks } from './src/sections/deep-links.js';
import { installEvents, installSettingsWatch } from './src/sections/events.js';
import { installGameLog } from './src/sections/game-log.js';
import { installNative } from './src/sections/native.js';
import { installNotifications } from './src/sections/notifications.js';
import { installOsc } from './src/sections/osc.js';
import { installRoutes } from './src/sections/routes.js';
import { installDashboardCard, installSettingsCard } from './src/sections/ui-dashboard.js';
import { installNavTab } from './src/sections/ui-nav-tab.js';
import { installSettingsSection } from './src/sections/ui-settings-section.js';
import { installVrchatData } from './src/sections/vrchat.js';

export default definePlugin({
  // Must equal "id" in plugin.json.
  id: 'example-plugin' as PluginId,
  settings,

  activate(ctx) {
    const state = createState(ctx);

    // Injected CSS is removed again on deactivate, like everything else on `ctx.ui`.
    ctx.ui.injectCss(PLUGIN_CSS);

    installSettingsWatch(ctx);
    installEvents(ctx, state);
    installGameLog(ctx, state);
    installOsc(ctx, state);
    installDeepLinks(ctx, state);
    installRoutes(ctx, state);
    installContextMenu(ctx, state);
    installNotifications(ctx, state);

    installDashboardCard(ctx, state);
    installNavTab(ctx, state);
    installSettingsSection(ctx, state);
    installSettingsCard(ctx, state);

    // Fire-and-forget: the first bridge call may prompt the user, and activation must never
    // wait on a prompt. Both of these report their own failures.
    void installNative(ctx, state);
    void installVrchatData(ctx, state);

    ctx.logger.info(`Example Plugin v${ctx.version} ready.`);
  },

  deactivate() {
    // Everything above was registered through `ctx`, so the host has already torn it down.
  },
});
