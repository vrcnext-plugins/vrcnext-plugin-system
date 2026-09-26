/**
 * Club Security.
 *
 * Watches VRChat's game log for players joining your instance. When the instance passes the
 * configured filters (type, group, world), it gathers what VRCNext knows about the joiner and
 * sends one report per join to the enabled channels.
 *
 * Compare with `plugin.json`: every category used here is declared there, and the exact action
 * and event names are listed so they are granted when the plugin is enabled.
 */

import { definePlugin, type PluginContext, type PluginId } from '@vrcnext/plugin-api';

import { FactCollector, type Joiner } from './src/collector.js';
import { filterFrom, instanceMatches } from './src/filters.js';
import { JoinMemory } from './src/memory.js';
import { notifyAll, type Report } from './src/notify.js';
import { ReportPanel } from './src/panel.js';
import { settings } from './src/settings.js';
import { toSelf, type Self } from './src/vrcnext-data.js';

type Ctx = PluginContext<typeof settings>;

/** VRCNext's parsed game-log kinds for `[Behaviour] OnPlayerJoined` and `Joining wrld_…`. */
const JOIN_EVENT = 'gl_player_join';
const WORLD_JOIN_EVENT = 'gl_world_join';

class ClubSecurity {
  readonly #ctx: Ctx;
  readonly #collector: FactCollector;
  readonly #memory: JoinMemory;
  readonly #panel: ReportPanel;
  /**
   * The signed-in account, from the `vrcUser` event VRCNext pushes after login and whenever the
   * profile is re-rendered. Empty until the first push: before that, only the settle window
   * keeps the local player's own `OnPlayerJoined` line from being reported.
   */
  #self: Self = { id: '', name: '' };
  /** Joiners currently being looked up, so a duplicate log line does not produce two reports. */
  readonly #inFlight = new Set<string>();
  /**
   * Until when joins count as "already here". VRChat logs an `OnPlayerJoined` for every player
   * present when the local player arrives, in one burst right after the local player's own line.
   */
  #settledAt = 0;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    this.#collector = new FactCollector(ctx);
    this.#memory = new JoinMemory(ctx.settings);
    this.#panel = new ReportPanel(ctx, {
      memory: this.#memory,
      currentInstance: () => this.#collector.instance,
      sendTest: () => this.#sendTest(),
    });
  }

  start(): void {
    this.#ctx.events.on('vrcUser', (payload) => {
      const self = toSelf(payload);
      if (self !== undefined) this.#self = self;
    });
    this.#ctx.events.on('vrcCurrentInstance', () => { this.#panel.refresh(); });
    this.#ctx.gameLog.onType(WORLD_JOIN_EVENT, () => { this.#startSettling(); });
    this.#ctx.gameLog.onType(JOIN_EVENT, (entry) => {
      void this.#onJoin({ name: entry.message, userId: entry.detail });
    });
    this.#panel.install();
    // Ask for the instance we are already in, so the first join after enabling is not missed.
    this.#ctx.bridge.send('vrcGetCurrentInstance');
    this.#ctx.logger.info(`Club Security v${this.#ctx.version} watching for joins.`);
  }

  #startSettling(): void {
    this.#settledAt = Date.now() + this.#ctx.settings.get('settleSecs') * 1000;
  }

  async #onJoin(joiner: Joiner): Promise<void> {
    const values = this.#ctx.settings.values;
    if (!values.enabled || joiner.name === '') return;
    if (this.#isSelf(joiner)) {
      this.#startSettling();
      return;
    }
    const instance = this.#collector.instance;
    if (instance === undefined) {
      this.#ctx.logger.debug(`${joiner.name} joined but the current instance is not known yet.`);
      return;
    }
    const filter = filterFrom(values);
    if (!instanceMatches(filter, instance)) return;

    const key = joiner.userId === '' ? `name:${joiner.name}` : joiner.userId;
    if (this.#inFlight.has(key)) return;
    this.#inFlight.add(key);
    try {
      const previous = await this.#memory.record(key, joiner.name, instance.location);
      if (Date.now() < this.#settledAt) {
        this.#ctx.logger.debug(`${joiner.name} was already here when you joined; remembered, not reported.`);
        this.#panel.refresh();
        return;
      }
      const facts = await this.#collector.collect(joiner, filter.groupId, values.collectTimeoutSecs * 1000);
      const report: Report = { at: Date.now(), joiner, instance, facts, groupFilter: filter.groupId, previous };
      this.#panel.push(report);
      this.#ctx.logger.info(`Reported ${joiner.name}: 18+ ${String(facts.ageVerified ?? '?')}, PC ${facts.avatar?.pc ?? '?'}, Quest ${facts.avatar?.quest ?? '?'}.`);
      await notifyAll(this.#ctx, report);
    } catch (error) {
      this.#ctx.logger.error(`Report for ${joiner.name} failed: ${String(error)}`);
    } finally {
      this.#inFlight.delete(key);
    }
  }

  #isSelf(joiner: Joiner): boolean {
    const self = this.#self;
    if (joiner.userId !== '' && self.id !== '') return joiner.userId === self.id;
    return self.name !== '' && joiner.name === self.name;
  }

  /** A report built from whatever the current instance knows about you, to check the channels. */
  async #sendTest(): Promise<void> {
    const instance = this.#collector.instance;
    if (instance === undefined) {
      this.#ctx.notifications.toast({ message: 'Join an instance first; the test uses it.', ok: false });
      return;
    }
    const self = this.#self;
    const me = instance.users.find((u) => u.id === self.id) ?? instance.users[0];
    const name = me?.displayName ?? self.name;
    const joiner: Joiner = { name: name === '' ? 'Test player' : name, userId: me?.id ?? '' };
    const filter = filterFrom(this.#ctx.settings.values);
    const facts = await this.#collector.collect(joiner, filter.groupId, 10_000);
    const report: Report = {
      at: Date.now(),
      joiner,
      instance,
      facts,
      groupFilter: filter.groupId,
      previous: this.#memory.previous(joiner.userId === '' ? `name:${joiner.name}` : joiner.userId),
    };
    await notifyAll(this.#ctx, report);
    this.#ctx.notifications.toast({ message: 'Test report sent to every enabled channel.' });
  }
}

export default definePlugin({
  id: 'club-security' as PluginId,
  settings,

  activate(ctx) {
    new ClubSecurity(ctx).start();
  },

  deactivate() {
    // Every listener and panel went through `ctx`, so the host tears them down.
  },
});
