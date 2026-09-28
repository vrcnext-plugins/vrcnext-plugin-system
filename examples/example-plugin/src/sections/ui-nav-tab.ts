/**
 * The plugin's own tab, declaratively, from `ctx.ui.kit`.
 *
 * No class names, no `createElement`, no stylesheet — and the result is VRCNext's own markup,
 * so it inherits the theme, the font-size offset and every future restyle of the app. This is
 * the file to copy when building plugin UI; `ui-dashboard.ts` shows the plain-DOM alternative.
 */

import type { Ctx, State } from '../state.js';

import { createLogPanel } from '../log-panel.js';
import { fetchStars } from './http.js';

export function installNavTab(ctx: Ctx, state: State): void {
  ctx.ui.addNavTab({
    label: 'Example Plugin',
    icon: 'auto_awesome',
    render: (tab) => {
      const k = ctx.ui.kit;
      const activity = k.card({ title: 'Live activity', icon: 'radar' });
      state.panel = createLogPanel(activity);

      const routeOutput = k.emptyState('No request yet.');
      const starsOutput = k.emptyState('Not fetched yet.');

      tab.append(
        k.layout(
          k.grid([
            counters(ctx, state),
            capabilities(ctx),
            routesCard(ctx, routeOutput),
            httpCard(ctx, starsOutput),
          ]),
          activity,
        ),
      );
    },
  });
}

function counters(ctx: Ctx, state: State): HTMLElement {
  const k = ctx.ui.kit;
  return k.card({
    title: 'Counters',
    icon: 'bolt',
    children: [
      k.stat({ label: 'Game log events', value: String(state.gameLogCount) }),
      k.stat({ label: 'OSC parameters', value: String(state.oscParamCount) }),
    ],
  });
}

/** What is available here and now — the honest answer, per platform and per permission. */
function capabilities(ctx: Ctx): HTMLElement {
  const k = ctx.ui.kit;
  return k.card({
    title: 'Capabilities',
    icon: 'tune',
    children: [
      k.row({
        label: 'OSC',
        value: ctx.osc.available ? k.badge('ok', 'Ready') : k.badge('warn', 'Windows only'),
        detail: 'Sent through VRCNext’s own sockets.',
      }),
      k.row({
        label: 'Network',
        value: ctx.permissions.has('network') ? k.badge('ok', 'Granted') : k.badge('neutral', 'Not asked yet'),
        detail: 'Optional; requested by the button below.',
      }),
      k.toggleRow({
        label: 'Follow the game log',
        detail: 'Mirrors VRChat log lines into the panel below.',
        value: ctx.settings.get('watchGameLog'),
        onChange: (next) => {
          void ctx.settings.set('watchGameLog', next);
        },
      }),
    ],
  });
}

function routesCard(ctx: Ctx, output: HTMLElement): HTMLElement {
  const k = ctx.ui.kit;
  return k.card({
    title: 'In-page routes',
    icon: 'account_tree',
    children: [
      k.description('Plugin routes are reachable from this page only, never from curl.'),
      k.buttonRow(
        k.button({
          label: 'GET stats',
          icon: 'download',
          onClick: () => {
            void ctx.router
              .fetch('stats')
              .then(async (response) => {
                output.textContent = await response.text();
              })
              .catch((error: unknown) => {
                output.textContent = String(error);
              });
          },
        }),
      ),
      output,
    ],
  });
}

function httpCard(ctx: Ctx, output: HTMLElement): HTMLElement {
  const k = ctx.ui.kit;
  return k.card({
    title: 'Outbound HTTP',
    icon: 'public',
    children: [
      k.description('Asks for the network permission, then fetches this repository’s star count.'),
      k.buttonRow(
        k.button({
          label: 'Fetch stars',
          icon: 'star',
          onClick: () => {
            void fetchStars(ctx)
              .then((text) => {
                output.textContent = text;
              })
              .catch((error: unknown) => {
                output.textContent = String(error);
              });
          },
        }),
      ),
      output,
    ],
  });
}
