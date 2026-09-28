/**
 * The session state every section shares, and the one function they all log through.
 *
 * Passing a small explicit object rather than reaching for module-level variables is what makes
 * each section deletable: nothing here is global, and removing a section removes its counters
 * with it.
 */

import type { PluginContext } from '@vrcnext/plugin-api';

import type { LogPanel } from './log-panel.js';
import type { settings } from './settings.js';

/** The context, with this plugin's settings schema attached, so `ctx.settings.get` stays typed. */
export type Ctx = PluginContext<typeof settings>;

export interface State {
  gameLogCount: number;
  oscParamCount: number;
  panel: LogPanel | undefined;
  /** Writes to both the plugin logger and the on-screen panel, honouring `verbosity`. */
  log(message: string): void;
}

/** A fresh state for one activation. */
export function createState(ctx: Ctx): State {
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
  return state;
}
