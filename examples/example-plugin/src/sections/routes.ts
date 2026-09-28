/**
 * In-page HTTP routes.
 *
 * These are reachable from this page and nothing else — not from curl, not from another
 * application. They are a way to structure the plugin's own UI, not a server.
 */

import type { Ctx, State } from '../state.js';

import { pulseOsc } from './osc.js';

export function installRoutes(ctx: Ctx, state: State): void {
  ctx.router.get('stats', () =>
    Response.json({
      gameLogEvents: state.gameLogCount,
      oscParams: state.oscParamCount,
      verbosity: ctx.settings.get('verbosity'),
    }),
  );

  ctx.router.get('greet/:name', (request) => Response.json({ hello: request.params['name'] ?? 'world' }));

  ctx.router.post('osc/pulse', () => Response.json({ sent: pulseOsc(ctx) }));

  ctx.logger.info(`Routes mounted at ${ctx.router.base.pathname}`);
}
