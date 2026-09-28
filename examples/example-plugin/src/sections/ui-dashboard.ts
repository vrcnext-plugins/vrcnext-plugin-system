/**
 * The dashboard card and the plugin's own settings cards.
 *
 * Plain DOM is allowed and is what this file uses, to show that it works; `nav-tab.ts` does the
 * same job through `ctx.ui.kit` and is the one to copy. No permission is needed for any of it.
 */

import type { Ctx, State } from '../state.js';

import { pulseOsc } from './osc.js';

export function installDashboardCard(ctx: Ctx, state: State): void {
  ctx.ui.addDashboardCard({
    title: 'Example Plugin',
    icon: 'auto_awesome',
    order: 10,
    render: (card) => {
      const grid = document.createElement('div');
      grid.className = 'ex-grid';
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
}

/** The card the host files under Settings → Plugins, with a modal and an entity picker. */
export function installSettingsCard(ctx: Ctx, state: State): void {
  ctx.ui.addSettingsCard({
    title: 'Example Plugin',
    icon: 'auto_awesome',
    render: (card) => {
      card.appendChild(
        ctx.ui.createToggleRow('Follow the VRChat game log', ctx.settings.get('watchGameLog'), (checked) => {
          void ctx.settings.set('watchGameLog', checked);
        }),
      );
      card.appendChild(resetButton(ctx));
      card.appendChild(ctx.ui.kit.buttonRow(pickButton(ctx, state)));
    },
  });
}

/** Blocking confirmation modal; resolves false on cancel, backdrop click or dismissal. */
function resetButton(ctx: Ctx): HTMLElement {
  const reset = document.createElement('button');
  reset.textContent = 'Reset settings';
  reset.addEventListener('click', () => {
    void ctx.notifications
      .confirm({
        title: 'Reset Example Plugin',
        message: 'Restore every setting to its default?',
        confirmLabel: 'Reset',
        icon: 'restart_alt',
      })
      .then(async (confirmed) => {
        if (!confirmed) return;
        await ctx.settings.reset();
        ctx.notifications.toast({ message: 'Example Plugin settings reset.' });
      });
  });
  return reset;
}

/**
 * The same picker the `user`/`world`/… settings use, opened on demand.
 *
 * No permission: it reads VRCNext's data on the user's behalf, and the plugin only ever sees
 * what was chosen.
 */
function pickButton(ctx: Ctx, state: State): HTMLElement {
  return ctx.ui.kit.button({
    label: 'Pick a friend…',
    icon: 'person_search',
    onClick: () => {
      void ctx.ui.pickEntity({ kind: 'user', scopes: ['friends', 'favorites'] }).then((ids) => {
        if (ids !== undefined && ids.length > 0) state.log(`[pick] ${ids.join(', ')}`);
      });
    },
  });
}

/** Stat tile that refreshes itself from a getter while it is actually on screen. */
function statTile(label: string, read: () => number): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'ex-stat';

  const labelEl = document.createElement('div');
  labelEl.className = 'ex-stat-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'ex-stat-value';
  valueEl.textContent = String(read());

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) valueEl.textContent = String(read());
    }
  });
  observer.observe(tile);

  tile.append(labelEl, valueEl);
  return tile;
}
