/**
 * The bridge's `state` service, as the host uses it.
 *
 * One JSON file on the bridge side replaces IndexedDB: it survives a change of VRCNext's local
 * port (which is a new origin, and would have orphaned an IndexedDB database), and the bridge
 * can read it too. Namespaces keep plugins apart: `host` for the host's own flags and grants,
 * `plugin:<id>` for that plugin's settings.
 *
 * The interface is small on purpose so tests can fake it with a `Map`.
 */

export const HOST_NS = 'host';

export function pluginNs(pluginId: string): string {
  return `plugin:${pluginId}`;
}

/** What the bridge accepts for a namespace or a key. */
export const STATE_NAME_PATTERN = /^[a-zA-Z0-9_.:-]{1,64}$/;

export interface StateService {
  get(ns: string, key: string): Promise<unknown>;
  set(ns: string, key: string, value: unknown): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  list(ns: string): Promise<Readonly<Record<string, unknown>>>;
}

/** The wire shapes: `state/get {ns,key}` → `{value}`, `state/list {ns}` → `{entries}`. */
type Call = (service: string, method: string, params: unknown) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class BridgeStateService implements StateService {
  readonly #call: Call;

  constructor(call: Call) {
    this.#call = call;
  }

  async get(ns: string, key: string): Promise<unknown> {
    const result = await this.#call('state', 'get', { ns, key });
    return isRecord(result) ? (result['value'] ?? undefined) : undefined;
  }

  async set(ns: string, key: string, value: unknown): Promise<void> {
    await this.#call('state', 'set', { ns, key, value });
  }

  async delete(ns: string, key: string): Promise<void> {
    await this.#call('state', 'delete', { ns, key });
  }

  async list(ns: string): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.#call('state', 'list', { ns });
    const entries = isRecord(result) ? result['entries'] : undefined;
    return isRecord(entries) ? entries : {};
  }
}

/** In-memory stand-in with the same contract, for tests. */
export class MemoryStateService implements StateService {
  readonly store = new Map<string, Map<string, unknown>>();
  /** Every write, in order, so a test can assert on coalescing. */
  readonly writes: { readonly ns: string; readonly key: string; readonly value: unknown }[] = [];

  #ns(ns: string): Map<string, unknown> {
    let map = this.store.get(ns);
    if (map === undefined) {
      map = new Map();
      this.store.set(ns, map);
    }
    return map;
  }

  get(ns: string, key: string): Promise<unknown> {
    return Promise.resolve(this.#ns(ns).get(key));
  }

  set(ns: string, key: string, value: unknown): Promise<void> {
    this.writes.push({ ns, key, value });
    this.#ns(ns).set(key, value);
    return Promise.resolve();
  }

  delete(ns: string, key: string): Promise<void> {
    this.#ns(ns).delete(key);
    return Promise.resolve();
  }

  list(ns: string): Promise<Readonly<Record<string, unknown>>> {
    return Promise.resolve(Object.fromEntries(this.#ns(ns)));
  }
}
