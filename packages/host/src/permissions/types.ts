/**
 * The permission prompt, as a contract.
 *
 * The decision logic (cache, queue, dedup, deny-for-session, revoke) lives in
 * {@link PermissionBroker} and is unit-tested against a fake of this interface; the DOM modal is
 * one implementation of it.
 */

import type { Permission, PermissionTone, PluginId } from '@vrcnext/plugin-api';

/** Who is asking. */
export interface PluginSubject {
  readonly id: PluginId;
  readonly name: string;
}

/**
 * What the user chose.
 *
 * - `allow`: for this page session only.
 * - `save`: persisted through the bridge's state store; survives reloads.
 * - `deny`: for this page session; the call rejects and the same target is not asked again.
 * - `uninstall`: remove the plugin; the pending call rejects.
 */
export type Decision = 'allow' | 'save' | 'deny' | 'uninstall';

export interface PromptDetail {
  readonly label: string;
  readonly value: string;
}

export interface PromptRequest {
  readonly plugin: PluginSubject;
  readonly kind: Permission;
  /** The concrete thing being asked about, or `*` for a once-per-plugin category. */
  readonly target: string;
  readonly title: string;
  readonly tone: PermissionTone;
  /** Collapsed by default in the modal. */
  readonly details: readonly PromptDetail[];
}

export interface PermissionPrompt {
  ask(request: PromptRequest): Promise<Decision>;
}

/** One saved grant, as listed in the manager. */
export interface Grant {
  readonly kind: Permission;
  readonly target: string;
}

/** The catch-all target for categories that are asked once per plugin. */
export const ANY_TARGET = '*';
