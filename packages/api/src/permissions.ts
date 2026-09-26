/**
 * The permission vocabulary.
 *
 * This file is the single source: the bridge validates `plugin.json` against these names, the
 * host gates every capability on them, and the consent modal shows the descriptions and tones
 * below. Adding a permission means adding it here and nowhere else first.
 *
 * `ui`, `settings`, `logger` and `disposables` need no permission: they can only affect the
 * plugin's own panels and its own stored values.
 */

export type PermissionTone = 'low' | 'medium' | 'high';

export interface PermissionInfo {
  /** One line, user-facing, shown in the consent modal. */
  readonly description: string;
  /** How much a user should think before granting. Drives the badge colour in the modal. */
  readonly tone: PermissionTone;
}

export const PERMISSIONS = {
  'host:events': {
    description: 'Receive VRCNext events, limited to the event names listed in plugin.json.',
    tone: 'low',
  },
  'host:actions': {
    description:
      'Send actions to VRCNext on your behalf, limited to the action names listed in plugin.json. ' +
      'Actions act on your real VRChat account.',
    tone: 'high',
  },
  'host:intercept': {
    description: 'Observe and drop every action VRCNext sends to its backend, including its own.',
    tone: 'high',
  },
  network: {
    description: 'Make HTTP requests, limited to the hosts listed in plugin.json.',
    tone: 'medium',
  },
  notifications: {
    description: 'Show toasts, confirmation dialogs and desktop notifications.',
    tone: 'low',
  },
  native: {
    description: 'Call the VRCNext Bridge: VR overlay and desktop notification targets.',
    tone: 'medium',
  },
  osc: {
    description: 'Send and receive OSC avatar parameters through VRCNext.',
    tone: 'medium',
  },
  gamelog: {
    description: 'Read the VRChat game log, live and its backlog.',
    tone: 'medium',
  },
  'context-menu': {
    description: 'Add entries to right-click menus.',
    tone: 'low',
  },
  routes: {
    description: 'Serve in-page HTTP routes under /plugins/<id>/.',
    tone: 'low',
  },
  clipboard: {
    description: 'Read and write the clipboard.',
    tone: 'medium',
  },
} as const satisfies Readonly<Record<string, PermissionInfo>>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as readonly Permission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);
}

export function permissionInfo(permission: Permission): PermissionInfo {
  return PERMISSIONS[permission];
}

/**
 * Thrown by a gated capability when the plugin holds no grant for it, or when the call names an
 * action, event or host outside the plugin's manifest allowlist.
 *
 * It is a plain `Error` subclass so a plugin can `catch` it and fall back; the `permission` field
 * tells it which one to `ctx.permissions.request`.
 */
export class PermissionError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission, detail?: string) {
    super(
      detail === undefined
        ? `Permission "${permission}" is not granted.`
        : `Permission "${permission}": ${detail}`,
    );
    this.name = 'PermissionError';
    this.permission = permission;
  }
}

export interface PermissionsApi {
  /** Whether the user has granted `permission` to this plugin. Cheap; safe to call per event. */
  has(permission: Permission): boolean;

  /**
   * Ask the user for one of the plugin's `optionalPermissions`.
   *
   * Opens the consent modal for that single permission and resolves with the decision. Resolves
   * `true` at once when it is already granted. Rejects when the permission is not declared as
   * optional in `plugin.json` — a required permission is granted at enable time or the plugin does
   * not run, and an undeclared one can never be requested.
   */
  request(permission: Permission): Promise<boolean>;
}
