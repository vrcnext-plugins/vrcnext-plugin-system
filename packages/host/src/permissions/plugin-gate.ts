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

  /** Pre-declared hosts, actions and events are granted at enable. */
  seedDeclared(): void {
    const { id, hosts, actions, events } = this.#manifest;
    this.#broker.seed(id, 'network', hosts);
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
