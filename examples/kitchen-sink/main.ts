/**
 * Kitchen Sink — the reference VRCNext plugin.
 *
 * Exercises every capability the host provides, in the order a plugin author is likely to need
 * them. Each section is small and commented so it can be copied out on its own. Compare each
 * section with `plugin.json`: every category used is declared there, the events are listed so
 * they are granted at enable, and `network` is optional so the fetch demo asks first.
 */

import {
  definePlugin,
  type ContextMenuEntry,
  type PluginContext,
  type PluginId,
  type SettingsSchema,
} from '@vrcnext/plugin-api';

import { PLUGIN_CSS } from './src/styles.js';
import { createLogPanel, type LogPanel } from './src/log-panel.js';

const settings = {
  watchGameLog: {
    kind: 'boolean',
    label: 'Follow the VRChat game log',
    description: 'Streams player joins and world changes into the panel below.',
    default: true,
  },
  oscParameter: {
    kind: 'string',
    label: 'OSC parameter to pulse',
    description: 'Sent to /avatar/parameters/<name> by the dashboard button.',
    default: 'VRCEmote',
    placeholder: 'VRCEmote',
  },
  oscValue: {
    kind: 'number',
    label: 'OSC value',
    default: 1,
    min: 0,
    max: 255,
    step: 1,
  },
  verbosity: {
    kind: 'select',
    label: 'Log verbosity',
    default: 'normal',
    options: [
      { value: 'quiet', label: 'Quiet' },
      { value: 'normal', label: 'Normal' },
      { value: 'loud', label: 'Everything' },
    ],
  },
} as const satisfies SettingsSchema;

type Ctx = PluginContext<typeof settings>;

/** Shared mutable state for the session. Reset each activation. */
interface State {
  gameLogCount: number;
  oscParamCount: number;
  panel: LogPanel | undefined;
  /** Writes to both the plugin logger and the on-screen panel, honouring `verbosity`. */
  log(message: string): void;
}

export default definePlugin({
  id: 'kitchen-sink' as PluginId,
  settings,

  activate(ctx) {
    const state: State = {
      gameLogCount: 0,
      oscParamCount: 0,
      panel: undefined,
      log: (message) => {
        if (ctx.settings.get('verbosity') === 'quiet') return;
        ctx.logger.info(message);
        state.panel?.append(message);
      },
    };

    // 1. Custom CSS, removed automatically on deactivate.
    ctx.ui.injectCss(PLUGIN_CSS);

    installSettingsWatch(ctx);
    installEvents(ctx, state);
    installGameLog(ctx, state);
    installOsc(ctx, state);
    installDeepLinks(ctx, state);
    installRoutes(ctx, state);
    installContextMenu(ctx, state);
    installNotifications(ctx, state);
    // Fire-and-forget: the first bridge call may prompt, and activation must not wait on it.
    void installNative(ctx, state);
    installUi(ctx, state);

    ctx.logger.info(`Kitchen Sink v${ctx.version} ready.`);
  },

  deactivate() {
    // Everything above registered through `ctx`, so the host tears it all down.
  },
});

/** 2. React to settings changes. `values` keeps its literal types. */
function installSettingsWatch(ctx: Ctx): void {
  ctx.disposables.add(
    ctx.settings.onChange((values) => {
      ctx.logger.debug(`Settings changed; verbosity is now ${values.verbosity}.`);
    }),
  );
}

/** 3. Typed host events, plus the untyped escape hatch. Both are listed in plugin.json. */
function installEvents(ctx: Ctx, state: State): void {
  // Fully typed: `payload.friendName` is a string.
  ctx.events.on('friendTimelineEvent', (payload) => {
    state.log(`[friend] ${payload.friendName} → ${payload.type}`);
  });

  // Not in the verified map, so the payload is `unknown` and must be narrowed.
  ctx.events.on('vrcCurrentInstance', (payload) => {
    if (typeof payload !== 'object' || payload === null) return;
    const worldName = (payload as { worldName?: unknown }).worldName;
    if (typeof worldName === 'string') state.log(`[instance] now in ${worldName}`);
  });

  // Not declared in plugin.json: the user is asked once whether this plugin may see every event.
  if (ctx.settings.get('verbosity') === 'loud') {
    ctx.events.onAny((envelope) => { ctx.logger.debug(`event ${envelope.type}`); });
  }
}

/** 4. VRChat game log — asked about once per plugin, the first time it is used. */
function installGameLog(ctx: Ctx, state: State): void {
  ctx.gameLog.on((entry) => {
    if (!ctx.settings.get('watchGameLog')) return;
    state.gameLogCount += 1;
    state.log(`[gamelog] ${entry.type}: ${entry.message}`);
  });

  ctx.gameLog.onType('OnPlayerJoined', (entry) => {
    state.log(`[join] ${entry.detail || entry.message}`);
  });

  // Backlog is fetched once, aborted if the plugin is disabled mid-flight.
  void ctx.gameLog
    .history(ctx.signal)
    .then((entries) => { ctx.logger.info(`Game log backlog: ${String(entries.length)} entries.`); })
    .catch((error: unknown) => {
      if (ctx.signal.aborted) return;
      ctx.logger.warn(`Could not read the game log: ${String(error)}`);
    });
}

/** 5. OSC in and out. Windows-only in VRCNext — always guard on `available`. */
function installOsc(ctx: Ctx, state: State): void {
  if (!ctx.osc.available) {
    state.log('[osc] OSC is Windows-only in VRCNext; skipping.');
    return;
  }
  ctx.osc.connect();

  ctx.osc.onParam((event) => {
    state.oscParamCount += 1;
    if (ctx.settings.get('verbosity') === 'loud') {
      state.log(`[osc] ${event.name} = ${String(event.value)}`);
    }
  });

  ctx.osc.onAvatarChange((event) => {
    state.log(`[osc] avatar ${event.avatarId} with ${String(event.parameters.length)} parameters`);
  });
}

/** Sends the configured parameter. Shared by the dashboard button and the HTTP route. */
function pulseOsc(ctx: Ctx): string {
  if (!ctx.osc.available) return 'OSC unavailable (Windows only)';
  const name = ctx.settings.get('oscParameter');
  const value = ctx.settings.get('oscValue');
  ctx.osc.send(name, 'int', value);
  return `${name} = ${String(value)}`;
}

/** 6. Deep links VRCNext delivers. Gated as the `openDeepLink` event, listed in plugin.json. */
function installDeepLinks(ctx: Ctx, state: State): void {
  ctx.deepLinks.onPrefix('wrld', (event) => {
    state.log(`[link] world ${event.id}`);
    return undefined; // Not handled — let other plugins see it too.
  });

  ctx.deepLinks.on((event) => {
    state.log(`[link] ${event.prefix}:${event.id}${event.action ? ` (${event.action})` : ''}`);
    return undefined;
  });
}

/** 7. In-page HTTP routes. Reachable from the page, not from outside it. */
function installRoutes(ctx: Ctx, state: State): void {
  ctx.router.get('stats', () =>
    Response.json({
      gameLogEvents: state.gameLogCount,
      oscParams: state.oscParamCount,
      verbosity: ctx.settings.get('verbosity'),
    }),
  );

  ctx.router.get('greet/:name', (request) =>
    Response.json({ hello: request.params['name'] ?? 'world' }),
  );

  ctx.router.post('osc/pulse', () => Response.json({ sent: pulseOsc(ctx) }));

  ctx.logger.info(`Routes mounted at ${ctx.router.base.pathname}`);
}

/** 8. Context-menu items, dividers and submenus. The clipboard asks the first time. */
function installContextMenu(ctx: Ctx, state: State): void {
  ctx.contextMenu.contribute((target) => {
    const entries: ContextMenuEntry[] = [
      { kind: 'divider' },
      {
        kind: 'item',
        icon: 'auto_awesome',
        label: 'Kitchen Sink: log this element',
        onSelect: () => { state.log(`[ctx] ${target.element.tagName.toLowerCase()}`); },
      },
      {
        kind: 'submenu',
        icon: 'tune',
        label: 'Kitchen Sink: verbosity',
        items: () =>
          settings.verbosity.options.map(
            (option): ContextMenuEntry => ({
              kind: 'item',
              icon: 'adjust',
              label: option.label,
              checked: ctx.settings.get('verbosity') === option.value,
              onSelect: () => { void ctx.settings.set('verbosity', option.value); },
            }),
          ),
      },
    ];

    if (target.entity !== undefined) {
      const entity = target.entity;
      entries.push({
        kind: 'item',
        icon: 'content_copy',
        label: `Copy ${entity.type} id`,
        onSelect: async () => {
          await ctx.clipboard.writeText(entity.id);
        },
      });
    }
    return entries;
  });
}

/** 9. Every notification surface VRCNext exposes. Needs only the `notifications` category. */
function installNotifications(ctx: Ctx, state: State): void {
  ctx.gameLog.onType('OnPlayerJoined', (entry) => {
    const who = entry.detail || entry.message;

    // In-app toast — always available.
    ctx.notifications.toast({ message: `${who} joined.` });

    // OS tray toast + SteamVR wrist overlay, in one call. Windows only.
    if (ctx.notifications.desktopAvailable) {
      ctx.notifications.desktop({ title: 'Player joined', subtitle: who, accent: 'info' });
    } else {
      state.log('[notify] desktop/VR notifications are Windows-only; the bridge covers Linux.');
    }
  });

  // Styled like one of VRCNext's own notification kinds.
  ctx.events.on('friendTimelineEvent', (payload) => {
    if (payload.type !== 'online') return;
    ctx.notifications.notifToast({ kind: 'notification', sender: payload.friendName, message: 'came online' });
  });
}

/**
 * 10. The VRCNext Bridge — VR overlay and desktop notification targets.
 *
 * The bridge is connected whenever a plugin runs, so there is nothing to probe. Each
 * `service/method` is confirmed by the user the first time it is called: `notify/targets` here,
 * `notify/send` on the first notification. Note the two-step: ask what targets exist, then
 * address them by name. Hard-coding `'wayvr'` would break the moment someone runs a different
 * overlay.
 */
async function installNative(ctx: Ctx, state: State): Promise<void> {
  let targets: readonly { readonly name: string }[];
  try {
    targets = await ctx.native.targets();
  } catch (error) {
    state.log(`[native] not allowed to list targets: ${String(error)}`);
    return;
  }
  state.log(`[native] targets: ${targets.map((t) => t.name).join(', ') || 'none'}`);

  ctx.gameLog.onType('OnPlayerJoined', (entry) => {
    const who = entry.detail || entry.message;

    // One call, presented differently in each place: a tall translucent panel in VR, an ordinary
    // toast on the monitor. Omitting `sinks` means "every target the bridge has".
    void ctx.native.notify({
      title: 'Player joined',
      content: who,
      timeoutSecs: 4,
      icon: 'user-available',
      overrides: {
        wayvr: { content: `${who} joined the instance`, height: 200, opacity: 0.85, alwaysShow: true },
      },
    }).catch((error: unknown) => { state.log(`[native] ${String(error)}`); });
  });

  // VR only — deliberately nothing on the monitor, because this fires often.
  ctx.events.on('friendTimelineEvent', (payload) => {
    if (payload.type !== 'online') return;
    void ctx.native.notify({
      title: payload.friendName,
      content: 'came online',
      sinks: ['wayvr'],
      timeoutSecs: 3,
      opacity: 0.7,
    }).catch((error: unknown) => { state.log(`[native] ${String(error)}`); });
  });
}

/**
 * 11. Outbound HTTP, behind an optional permission.
 *
 * `network` is in `optionalPermissions`, so the plugin asks for the category first; the host
 * `api.github.com` is pre-declared in `hosts`, so once the category is granted the request goes
 * through without a second prompt. A host not listed would prompt again, per host.
 */
async function fetchStars(ctx: Ctx): Promise<string> {
  if (!(await ctx.permissions.request('network'))) return 'Network access declined.';
  const response = await ctx.http.fetch(
    'https://api.github.com/repos/vrcnext-plugins/vrcnext-plugin-system',
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  const body = (await response.json()) as { stargazers_count?: unknown };
  return typeof body.stargazers_count === 'number'
    ? `${String(body.stargazers_count)} stars`
    : `HTTP ${String(response.status)}`;
}

/** 12. UI: a dashboard card, a sidebar tab and a settings card. No permission needed. */
function installUi(ctx: Ctx, state: State): void {
  ctx.ui.addDashboardCard({
    title: 'Kitchen Sink',
    icon: 'auto_awesome',
    order: 10,
    render: (card) => {
      const grid = document.createElement('div');
      grid.className = 'ks-grid';
      grid.append(
        statTile('Game log events', () => state.gameLogCount),
        statTile('OSC parameters', () => state.oscParamCount),
      );
      card.appendChild(grid);

      const pulse = document.createElement('button');
      pulse.textContent = 'Send OSC pulse';
      pulse.addEventListener('click', () => {
        ctx.ui.toast({ message: `Sent ${pulseOsc(ctx)}.` });
      });
      card.appendChild(pulse);
    },
  });

  installNavTab(ctx, state);

  ctx.ui.addSettingsCard({
    title: 'Kitchen Sink',
    icon: 'auto_awesome',
    render: (card) => {
      card.appendChild(
        ctx.ui.createToggleRow(
          'Follow the VRChat game log',
          ctx.settings.get('watchGameLog'),
          (checked) => { void ctx.settings.set('watchGameLog', checked); },
        ),
      );

      // Blocking confirmation modal; resolves false on cancel, backdrop click or dismissal.
      const reset = document.createElement('button');
      reset.textContent = 'Reset settings';
      reset.addEventListener('click', () => {
        void ctx.notifications
          .confirm({
            title: 'Reset Kitchen Sink',
            message: 'Restore every Kitchen Sink setting to its default?',
            confirmLabel: 'Reset',
            icon: 'restart_alt',
          })
          .then(async (confirmed) => {
            if (!confirmed) return;
            await ctx.settings.reset();
            ctx.notifications.toast({ message: 'Kitchen Sink settings reset.' });
          });
      });
      card.appendChild(reset);
    },
  });
}

/**
 * The plugin's tab, declaratively, from `ctx.ui.kit`.
 *
 * No class names, no `createElement`, no stylesheet — and the result is VRCNext's own markup, so
 * it inherits the theme, the font-size offset and every future restyle of the app.
 */
function installNavTab(ctx: Ctx, state: State): void {
  ctx.ui.addNavTab({
    label: 'Kitchen Sink',
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
            k.card({
              title: 'Counters',
              icon: 'bolt',
              children: [
                k.stat({ label: 'Game log events', value: String(state.gameLogCount) }),
                k.stat({ label: 'OSC parameters', value: String(state.oscParamCount) }),
              ],
            }),
            k.card({
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
                  onChange: (next) => { void ctx.settings.set('watchGameLog', next); },
                }),
              ],
            }),
            k.card({
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
                        .then(async (response) => { routeOutput.textContent = await response.text(); })
                        .catch((error: unknown) => { routeOutput.textContent = String(error); });
                    },
                  }),
                ),
                routeOutput,
              ],
            }),
            k.card({
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
                        .then((text) => { starsOutput.textContent = text; })
                        .catch((error: unknown) => { starsOutput.textContent = String(error); });
                    },
                  }),
                ),
                starsOutput,
              ],
            }),
          ]),
          activity,
        ),
      );
    },
  });
}

/** Stat tile that refreshes itself from a getter while the dashboard is visible. */
function statTile(label: string, read: () => number): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'ks-stat';

  const labelEl = document.createElement('div');
  labelEl.className = 'ks-stat-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'ks-stat-value';
  valueEl.textContent = String(read());

  // Repaint only while the tile is actually on screen.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) valueEl.textContent = String(read());
    }
  });
  observer.observe(tile);

  tile.append(labelEl, valueEl);
  return tile;
}
