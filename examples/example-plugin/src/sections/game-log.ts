/**
 * The VRChat game log: live lines, one type in particular, and the backlog.
 *
 * The `gamelog` category is asked about once per plugin, the first time it is used.
 */

import type { Ctx, State } from '../state.js';

export function installGameLog(ctx: Ctx, state: State): void {
  ctx.gameLog.on((entry) => {
    if (!ctx.settings.get('watchGameLog')) return;
    state.gameLogCount += 1;
    state.log(`[gamelog] ${entry.type}: ${entry.message}`);
  });

  ctx.gameLog.onType('gl_player_join', (entry) => {
    state.log(`[join] ${entry.message}`);
  });

  // Fetched once and aborted if the plugin is disabled mid-flight, which is what `ctx.signal`
  // is for: after a disable, the rejection is expected and must not be reported.
  void ctx.gameLog
    .history(ctx.signal)
    .then((entries) => {
      ctx.logger.info(`Game log backlog: ${String(entries.length)} entries.`);
    })
    .catch((error: unknown) => {
      if (ctx.signal.aborted) return;
      ctx.logger.warn(`Could not read the game log: ${String(error)}`);
    });
}
