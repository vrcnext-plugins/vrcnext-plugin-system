/**
 * Kitchen Sink — the reference VRCNext plugin.
 *
 * Exercises every capability the host provides, in the order a plugin author is likely to need
 * them. Each section is small and commented so it can be copied out on its own.
 */

import {
  definePlugin,
  type ContextMenuEntry,
  type PluginContext,
  type PluginId,
  type SettingsSchema,
} from '@vrcnext/plugin-api';

import { PLUGIN_CSS } from './styles.js';
import { createLogPanel, type LogPanel } from './log-panel.js';

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
    installUi(ctx, state);

    ctx.logger.info(`Kitchen Sink v${ctx.version} ready.`);
  },

  deactivate() {
    // Everything above registered through `ctx`, so the host tears it all down. Only resources
    // created outside the context would need explicit cleanup here.
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

/** 3. Typed host events, plus the untyped escape hatch. */
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

  // Diagnostics: every event flowing from VRCNext.
  ctx.events.onAny((envelope) => {
    if (ctx.settings.get('verbosity') === 'loud') {
      ctx.logger.debug(`event ${envelope.type}`);
    }
  });
}

/** 4. VRChat game log — the lowest-latency source of in-game activity. */
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

/** 6. Deep links VRCNext delivers. Custom prefixes are not possible — see the docs. */
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

/** 8. Context-menu items, dividers and submenus. */
function installContextMenu(ctx: Ctx, state: State): void {
  ctx.contextMenu.contribute((target) => {
    const entries: ContextMenuEntry[] = [
      { kind: 'divider' },
      {
        kind: 'item',
        icon: 'science',
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
              icon: 'radio_button_checked',
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
        onSelect: () => { void navigator.clipboard.writeText(entity.id); },
      });
    }
    return entries;
  });
}

/** 9. Every notification surface VRCNext exposes. */
function installNotifications(ctx: Ctx, state: State): void {
  ctx.gameLog.onType('OnPlayerJoined', (entry) => {
    const who = entry.detail || entry.message;

    // In-app toast — always available.
    ctx.notifications.toast({ message: `${who} joined.` });

    // OS tray toast + SteamVR wrist overlay, in one call. Windows only.
    if (ctx.notifications.desktopAvailable) {
      ctx.notifications.desktop({
        title: 'Player joined',
        subtitle: who,
        accent: 'info',
      });
    } else {
      state.log('[notify] desktop/VR notifications are Windows-only.');
    }
  });

  // Styled like one of VRCNext's own notification kinds.
  ctx.events.on('friendTimelineEvent', (payload) => {
    if (payload.type !== 'online') return;
    ctx.notifications.notifToast({
      kind: 'notification',
      sender: payload.friendName,
      message: 'came online',
    });
  });
}

/** 10. UI: a dashboard card, a sidebar tab and a settings card. */
function installUi(ctx: Ctx, state: State): void {
  ctx.ui.addDashboardCard({
    title: 'Kitchen Sink',
    icon: 'science',
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

  ctx.ui.addNavTab({
    label: 'Kitchen Sink',
    icon: 'science',
    render: (tab) => {
      const card = ctx.ui.createCard('Live activity', 'monitoring');
      state.panel = createLogPanel(card);
      tab.appendChild(card);

      const routes = ctx.ui.createCard('In-page routes', 'route');
      const output = document.createElement('div');
      output.className = 'ks-log';
      const call = document.createElement('button');
      call.textContent = 'GET stats';
      call.addEventListener('click', () => {
        void ctx.router
          .fetch('stats')
          .then(async (response) => { output.textContent = await response.text(); })
          .catch((error: unknown) => { output.textContent = String(error); });
      });
      routes.append(call, output);
      tab.appendChild(routes);
    },
  });

  ctx.ui.addSettingsCard({
    title: 'Kitchen Sink',
    icon: 'science',
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
