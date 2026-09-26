/**
 * Saved grants, in the bridge's state store.
 *
 * One entry per plugin, ns `host`, key `grants:<pluginId>`, value the list of `{kind, target}`.
 * A key per grant would read more naturally but cannot hold a bridge target such as
 * `notify/send` or the `*` catch-all: the state service restricts keys to `[a-zA-Z0-9_.:-]` and
 * 64 characters, and a domain plus a plugin id already runs close to that.
 */

import { isPermission, type PluginId } from '@vrcnext/plugin-api';

import { HOST_NS, type StateService } from '../state/state-service.js';
import type { Grant } from './types.js';

const KEY_PREFIX = 'grants:';

export function grantsKey(pluginId: PluginId): string {
  return `${KEY_PREFIX}${pluginId}`;
}

function parseGrants(value: unknown): Grant[] {
  if (!Array.isArray(value)) return [];
  const out: Grant[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { kind, target } = item as { kind?: unknown; target?: unknown };
    if (isPermission(kind) && typeof target === 'string') out.push({ kind, target });
  }
  return out;
}

export class GrantStore {
  readonly #state: StateService;
  readonly #byPlugin = new Map<string, Grant[]>();

  constructor(state: StateService) {
    this.#state = state;
  }

  /** Read every plugin's grants. Called once, after the bridge connects. */
  async load(): Promise<void> {
    this.#byPlugin.clear();
    const entries = await this.#state.list(HOST_NS);
    for (const [key, value] of Object.entries(entries)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      this.#byPlugin.set(key.slice(KEY_PREFIX.length), parseGrants(value));
    }
  }

  /** Every plugin id that has at least one saved grant. */
  pluginIds(): readonly string[] {
    return [...this.#byPlugin.keys()];
  }

  list(pluginId: PluginId): readonly Grant[] {
    return this.#byPlugin.get(pluginId) ?? [];
  }

  has(pluginId: PluginId, grant: Grant): boolean {
    return this.list(pluginId).some((g) => g.kind === grant.kind && g.target === grant.target);
  }

  async add(pluginId: PluginId, grant: Grant): Promise<void> {
    if (this.has(pluginId, grant)) return;
    const next = [...this.list(pluginId), grant];
    this.#byPlugin.set(pluginId, next);
    await this.#state.set(HOST_NS, grantsKey(pluginId), next);
  }

  async remove(pluginId: PluginId, grant: Grant): Promise<void> {
    const next = this.list(pluginId).filter(
      (g) => !(g.kind === grant.kind && g.target === grant.target),
    );
    await this.#write(pluginId, next);
  }

  async clear(pluginId: PluginId): Promise<void> {
    await this.#write(pluginId, []);
  }

  async #write(pluginId: PluginId, next: readonly Grant[]): Promise<void> {
    if (next.length === 0) {
      this.#byPlugin.delete(pluginId);
      await this.#state.delete(HOST_NS, grantsKey(pluginId));
      return;
    }
    this.#byPlugin.set(pluginId, [...next]);
    await this.#state.set(HOST_NS, grantsKey(pluginId), next);
  }
}
