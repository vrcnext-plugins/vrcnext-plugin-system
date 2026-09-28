/**
 * One plugin's view of the permission model.
 *
 * Two layers: the *category* ceiling from `plugin.json` (a category that is not declared is
 * refused outright, without a prompt) and the *target* decision from the broker (asked on first
 * use). Sync APIs such as `events.on` cannot await a prompt, so {@link whenAllowed} runs the
 * effect once the answer is in and logs a denial instead of throwing into the caller.
 */

import {
  PermissionError,
  type Logger,
  type Permission,
  type PermissionsApi,
  type PluginManifest,
} from '@vrcnext/plugin-api';

import type { PermissionBroker } from './broker.js';
import { categoryPrompt } from './prompts.js';
import { ANY_TARGET, type PluginSubject, type PromptRequest } from './types.js';

export class PluginGate implements PermissionsApi {
  readonly subject: PluginSubject;
  readonly #manifest: PluginManifest;
  readonly #broker: PermissionBroker;
  readonly #logger: Logger;

  constructor(manifest: PluginManifest, broker: PermissionBroker, logger: Logger) {
    this.subject = { id: manifest.id, name: manifest.name };
    this.#manifest = manifest;
    this.#broker = broker;
    this.#logger = logger;
  }

  /**
   * Pre-declared actions and events are granted at enable.
   *
   * `hosts` deliberately is not, although it is declared the same way. A request now leaves this
   * machine through the bridge rather than the page, which reaches hosts a browser would refuse
   * to read from — this machine's own network included — so the user is asked about each host
   * the first time a plugin goes there, and can save that answer. The manifest's list is still
   * what the enable dialog shows: it is the plugin stating where it means to go.
   */
  seedDeclared(): void {
    const { id, actions, events } = this.#manifest;
    this.#broker.seed(id, 'host:actions', actions);
    this.#broker.seed(id, 'host:events', events);
  }

  has(permission: Permission): boolean {
    if (this.#manifest.permissions.includes(permission)) return true;
    return (
      this.#manifest.optionalPermissions.includes(permission) &&
      this.#broker.isAllowed(this.#manifest.id, permission, ANY_TARGET)
    );
  }

  async request(permission: Permission): Promise<boolean> {
    if (this.has(permission)) return true;
    if (!this.#manifest.optionalPermissions.includes(permission)) {
      throw new PermissionError(permission, 'not declared in optionalPermissions');
    }
    try {
      await this.#broker.ensure(categoryPrompt(this.subject, permission));
      return true;
    } catch (error) {
      if (error instanceof PermissionError) return false;
      throw error;
    }
  }

  /**
   * Throws when an action or event name is not in `plugin.json`.
   *
   * Both lists are constants in a plugin's source, so a manifest can name every one it will
   * ever use, and the enable dialog can therefore show the user a complete list. An undeclared
   * name is refused outright rather than prompted for, because a prompt half-way through a
   * session is precisely the thing that dialog was supposed to make unnecessary. `"*"` declares
   * the whole stream, which is what `onAny` needs and what the dialog then shows.
   *
   * `hosts` is deliberately not treated this way: a URL can come from a setting the user typed,
   * so an undeclared host still asks rather than refusing.
   */
  requireDeclared(kind: 'host:actions' | 'host:events', name: string): void {
    const declared = kind === 'host:actions' ? this.#manifest.actions : this.#manifest.events;
    if (declared.includes(name) || declared.includes(ANY_TARGET)) return;
    const field = kind === 'host:actions' ? 'actions' : 'events';
    const detail = `"${name}" is not listed in plugin.json "${field}"`;
    this.#logger.error(`Refused: ${detail}.`);
    throw new PermissionError(kind, detail);
  }

  /** Throws when the category is outside the plugin's ceiling. Logged, never prompted. */
  requireCategory(permission: Permission): void {
    if (this.has(permission)) return;
    this.#logger.error(`Refused: "${permission}" is not declared in plugin.json.`);
    throw new PermissionError(permission);
  }

  /** Whether the target is already allowed, without asking. */
  isAllowed(request: PromptRequest): boolean {
    return this.#broker.isAllowed(request.plugin.id, request.kind, request.target);
  }

  /** For async APIs: resolves once the target is allowed. */
  async check(request: PromptRequest): Promise<void> {
    this.requireCategory(request.kind);
    await this.#broker.ensure(request);
  }

  /**
   * For sync APIs: runs `effect` now when the target is already allowed, otherwise after the
   * user allows it. A denial is logged; the caller has already returned.
   */
  whenAllowed(request: PromptRequest, effect: () => void): void {
    this.requireCategory(request.kind);
    if (this.#broker.isAllowed(request.plugin.id, request.kind, request.target)) {
      effect();
      return;
    }
    void this.#broker.ensure(request).then(effect, (error: unknown) => {
      this.#logger.warn(error instanceof Error ? error.message : String(error));
    });
  }
}
