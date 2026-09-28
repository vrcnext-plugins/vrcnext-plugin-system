/**
 * Decides whether a plugin may touch a concrete target, asking the user the first time.
 *
 * # Hot path
 *
 * Steady state is one `Map` lookup per call: every decision — saved grants loaded at boot,
 * targets pre-declared in `plugin.json` and seeded at enable, and whatever the user answered this
 * session — lands in the same map. Only a miss reaches the prompt.
 *
 * # Prompting
 *
 * One modal at a time, in arrival order. Identical concurrent requests (same plugin, kind and
 * target) share one prompt and one answer, so a burst of `fetch` calls to the same host asks
 * once. A denial is remembered for the session so the plugin is not re-asked on its next retry
 * loop; the call rejects with a {@link PermissionError} that names the kind and target.
 */

import { PermissionError, type Permission, type PluginId } from '@vrcnext/plugin-api';

import type { GrantStore } from './grant-store.js';
import type { Decision, Grant, PermissionPrompt, PromptRequest } from './types.js';

type Verdict = 'allow' | 'deny';

export interface BrokerDeps {
  readonly grants: GrantStore;
  readonly prompt: PermissionPrompt;
  /** The user chose Uninstall on a prompt. Runs before the pending call is rejected. */
  readonly onUninstall: (pluginId: PluginId) => Promise<void>;
  readonly log: (message: string) => void;
}

function cacheKey(pluginId: PluginId, kind: Permission, target: string): string {
  // `\0` cannot occur in an id, a permission name or a target, so the parts cannot collide.
  return `${pluginId}\0${kind}\0${target}`;
}

/** `promise`, or the signal's reason as soon as it aborts, whichever comes first. */
function raceAbort(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { reject(abortReason(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      () => { signal.removeEventListener('abort', onAbort); resolve(); },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException('The plugin was disabled.', 'AbortError');
}

export class PermissionBroker {
  readonly #deps: BrokerDeps;
  readonly #decisions = new Map<string, Verdict>();
  readonly #inFlight = new Map<string, Promise<void>>();
  /** Serialises prompts so only one modal is open at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: BrokerDeps) {
    this.#deps = deps;
  }

  /** Copy every saved grant into the decision cache. Call once the grant store has loaded. */
  loadSaved(): void {
    for (const pluginId of this.#deps.grants.pluginIds()) {
      for (const grant of this.#deps.grants.list(pluginId as PluginId)) {
        this.#decisions.set(cacheKey(pluginId as PluginId, grant.kind, grant.target), 'allow');
      }
    }
  }

  /** Targets pre-declared in the manifest are granted at enable, for the session. */
  seed(pluginId: PluginId, kind: Permission, targets: readonly string[]): void {
    for (const target of targets) {
      const key = cacheKey(pluginId, kind, target);
      if (this.#decisions.get(key) !== 'deny') this.#decisions.set(key, 'allow');
    }
  }

  /** Synchronous check. `true` only for an already-allowed target. */
  isAllowed(pluginId: PluginId, kind: Permission, target: string): boolean {
    return this.#decisions.get(cacheKey(pluginId, kind, target)) === 'allow';
  }

  /**
   * Resolve once the target is allowed, asking the user if nothing has decided it yet.
   *
   * `signal` is the requesting plugin's lifetime. Once it aborts the call rejects with its
   * reason, and a prompt still waiting in the queue is dropped instead of shown: a plugin that
   * was disabled has nothing left to ask for. A modal already on screen stays until answered,
   * and its answer is still recorded, but nobody waits on it.
   *
   * @throws {PermissionError} when denied, now or earlier this session, or after an uninstall.
   */
  async ensure(request: PromptRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const key = cacheKey(request.plugin.id, request.kind, request.target);
    const cached = this.#decisions.get(key);
    if (cached === 'allow') return;
    if (cached === 'deny') throw PermissionBroker.#denied(request);

    let pending = this.#inFlight.get(key);
    if (pending === undefined) {
      pending = this.#ask(request, key, signal).finally(() => { this.#inFlight.delete(key); });
      this.#inFlight.set(key, pending);
    }
    return signal === undefined ? pending : raceAbort(pending, signal);
  }

  async #ask(request: PromptRequest, key: string, signal: AbortSignal | undefined): Promise<void> {
    // A prompt that was queued behind another may already be answered by that one's "save":
    // re-check after our turn comes rather than asking twice.
    const decision = await this.#enqueue(async () => {
      signal?.throwIfAborted();
      const now = this.#decisions.get(key);
      if (now === 'allow') return 'allow';
      if (now === 'deny') return 'deny';
      return this.#deps.prompt.ask(request);
    });
    await this.#apply(request, key, decision);
  }

  #enqueue(work: () => Promise<Decision>): Promise<Decision> {
    const turn = this.#queue.then(work, work);
    this.#queue = turn.catch(() => undefined);
    return turn;
  }

  async #apply(request: PromptRequest, key: string, decision: Decision): Promise<void> {
    const { plugin, kind, target } = request;
    switch (decision) {
      case 'allow':
        this.#decisions.set(key, 'allow');
        this.#deps.log(`${plugin.id}: allowed ${kind} ${target} for this session.`);
        return;
      case 'save':
        this.#decisions.set(key, 'allow');
        await this.#deps.grants.add(plugin.id, { kind, target });
        this.#deps.log(`${plugin.id}: allowed ${kind} ${target} and saved it.`);
        return;
      case 'deny':
        this.#decisions.set(key, 'deny');
        this.#deps.log(`${plugin.id}: denied ${kind} ${target} for this session.`);
        throw PermissionBroker.#denied(request);
      case 'uninstall':
        this.#deps.log(`${plugin.id}: uninstall chosen on the ${kind} ${target} prompt.`);
        this.forget(plugin.id);
        await this.#deps.onUninstall(plugin.id);
        throw new PermissionError(kind, 'the plugin is being uninstalled', target);
    }
  }

  static #denied(request: PromptRequest): PermissionError {
    return new PermissionError(request.kind, `denied for ${request.target}`, request.target);
  }

  savedGrants(pluginId: PluginId): readonly Grant[] {
    return this.#deps.grants.list(pluginId);
  }

  /** Drop one saved grant. The next use prompts again; nothing restarts. */
  async revoke(pluginId: PluginId, grant: Grant): Promise<void> {
    this.#decisions.delete(cacheKey(pluginId, grant.kind, grant.target));
    await this.#deps.grants.remove(pluginId, grant);
  }

  /** Drop every saved grant of a plugin, and its session decisions with them. */
  async forgetAll(pluginId: PluginId): Promise<void> {
    await this.#deps.grants.clear(pluginId);
    this.forget(pluginId);
  }

  /** Drop the session decisions of a plugin. Saved grants stay. */
  forget(pluginId: PluginId): void {
    const prefix = `${pluginId}\0`;
    for (const key of [...this.#decisions.keys()]) {
      if (key.startsWith(prefix)) this.#decisions.delete(key);
    }
    // Saved grants stay valid; put them back so the hot path keeps hitting.
    for (const grant of this.#deps.grants.list(pluginId)) {
      this.#decisions.set(cacheKey(pluginId, grant.kind, grant.target), 'allow');
    }
  }
}
