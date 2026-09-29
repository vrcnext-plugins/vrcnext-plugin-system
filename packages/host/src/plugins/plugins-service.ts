/**
 * The bridge's `plugins` service, typed.
 *
 * Wire shapes (all over the shared socket, `request {id, service: 'plugins', method, params}`):
 *
 * | method          | params  | result                                        |
 * | :-------------- | :------ | :-------------------------------------------- |
 * | `install`       | `{url}` | `{plugin: InstalledPlugin}`                   |
 * | `list`          | `{}`    | `{plugins: InstalledPlugin[]}`                |
 * | `check_updates` | `{}`    | `{updates: PluginUpdate[]}`                   |
 * | `update`        | `{id}`  | `{plugin?: InstalledPlugin}`                  |
 * | `uninstall`     | `{id}`  | `{}`                                          |
 * | `build`         | `{}`    | `BuildResult`                                 |
 * | `keys`          | `{}`    | `{keys: TrustedKey[]}`                        |
 * | `forget_key`    | `{keyId}` | `{}`                                        |
 *
 * Pushes: `progress {op, id, step, message}`, `build BuildResult`, `plugins {plugins}`.
 *
 * Every tree the bridge installs has to carry a valid `plugin.sig`, and the key that signed it
 * has to be one the user has accepted at the desktop prompt. That is why an install can produce
 * two confirmations — one for the repository, one for a key this machine has not seen — and why
 * an update signed by a different key than the plugin was installed under produces a third.
 * `keyId` on an installed plugin is the key it is pinned to.
 *
 * `install`, `update`, `uninstall` and `forget_key` are confirmed by the bridge on the desktop
 * before they run, so those calls wait far longer than a local round trip. Their errors are
 * `bad_request` with a stable code at the front of the message; {@link describeError} turns the
 * ones a user can act on into sentences.
 */

import type { PluginId } from '@vrcnext/plugin-api';

import { NativeRequestError, type RequestOptions } from '../capabilities/native.js';

/** How long a desktop confirmation may take, plus the clone or fetch behind it. */
export const CONFIRMED_CALL_TIMEOUT_MS = 130_000;

/** A `progress` push while the bridge waits for the user to confirm on the desktop. */
export const STEP_AWAITING_CONFIRMATION = 'awaiting_confirmation';

export const BRIDGE_DOCS_URL = 'https://vrcnext-plugins.github.io/native-companion.html';

export interface InstalledPlugin {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly url: string;
  readonly commit: string;
  readonly tags: readonly string[];
  readonly permissions: readonly string[];
  readonly optionalPermissions: readonly string[];
  readonly actions: readonly string[];
  readonly events: readonly string[];
  readonly hosts: readonly string[];
  readonly installedAt: string;
  readonly updatedAt: string;
  /** Fingerprint of the signing key this plugin is pinned to; empty for a pre-signing install. */
  readonly keyId: string;
}

/** A signing key the user has accepted, as the bridge remembers it. */
export interface TrustedKey {
  readonly keyId: string;
  readonly publicKey: string;
  /** What the key was first accepted for: the plugin id and the URL it came from. */
  readonly label: string;
  readonly trustedAt: number;
  readonly lastUsedAt: number;
  /** Every plugin ever seen signed by this key. */
  readonly seenFor: readonly string[];
  /** Plugins currently installed and pinned to it. */
  readonly installed: readonly string[];
}

export interface ChangelogEntry {
  readonly commit: string;
  readonly summary: string;
  readonly time: string;
}

export interface PluginUpdate {
  readonly id: PluginId;
  readonly current: string;
  readonly latest: string;
  readonly commitsBehind: number;
  readonly changelog: readonly ChangelogEntry[];
}

export interface BuildResult {
  readonly ok: boolean;
  readonly durationMs: number;
  readonly plugins: readonly string[];
  readonly errors: readonly string[];
}

export interface Progress {
  readonly op: string;
  readonly id: string;
  readonly step: string;
  readonly message: string;
}

type Call = (service: string, method: string, params: unknown, options?: RequestOptions) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function toInstalledPlugin(raw: unknown): InstalledPlugin | undefined {
  if (!isRecord(raw) || typeof raw['id'] !== 'string') return undefined;
  return {
    id: raw['id'] as PluginId,
    name: str(raw['name'], raw['id']),
    version: str(raw['version'], '0.0.0'),
    description: str(raw['description']),
    url: str(raw['url']),
    commit: str(raw['commit']),
    tags: strings(raw['tags']),
    permissions: strings(raw['permissions']),
    optionalPermissions: strings(raw['optionalPermissions']),
    actions: strings(raw['actions']),
    events: strings(raw['events']),
    hosts: strings(raw['hosts']),
    installedAt: str(raw['installedAt']),
    updatedAt: str(raw['updatedAt']),
    keyId: str(raw['keyId']),
  };
}

export function toInstalledList(raw: unknown): readonly InstalledPlugin[] {
  const list = isRecord(raw) ? raw['plugins'] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const plugin = toInstalledPlugin(entry);
    return plugin === undefined ? [] : [plugin];
  });
}

function toUpdate(raw: unknown): PluginUpdate | undefined {
  if (!isRecord(raw) || typeof raw['id'] !== 'string') return undefined;
  const changelog = Array.isArray(raw['changelog']) ? raw['changelog'] : [];
  return {
    id: raw['id'] as PluginId,
    current: str(raw['current']),
    latest: str(raw['latest']),
    commitsBehind: typeof raw['commitsBehind'] === 'number' ? raw['commitsBehind'] : 0,
    changelog: changelog.flatMap((entry) =>
      isRecord(entry)
        ? [{ commit: str(entry['commit']), summary: str(entry['summary']), time: str(entry['time']) }]
        : [],
    ),
  };
}

function toTrustedKey(raw: unknown): TrustedKey | undefined {
  if (!isRecord(raw) || typeof raw['keyId'] !== 'string') return undefined;
  const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
  return {
    keyId: raw['keyId'],
    publicKey: str(raw['publicKey']),
    label: str(raw['label']),
    trustedAt: num(raw['trustedAt']),
    lastUsedAt: num(raw['lastUsedAt']),
    seenFor: strings(raw['seenFor']),
    installed: strings(raw['installed']),
  };
}

export function toBuildResult(raw: unknown): BuildResult {
  const record = isRecord(raw) ? raw : {};
  return {
    ok: record['ok'] === true,
    durationMs: typeof record['durationMs'] === 'number' ? record['durationMs'] : 0,
    plugins: strings(record['plugins']),
    errors: strings(record['errors']),
  };
}

export function toProgress(raw: unknown): Progress | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    op: str(raw['op']),
    id: str(raw['id']),
    step: str(raw['step']),
    message: str(raw['message']),
  };
}

/** A user-facing sentence for the bridge's stable error codes; anything else passes through. */
export function describeError(error: unknown): string {
  if (!(error instanceof NativeRequestError)) {
    return error instanceof Error ? error.message : String(error);
  }
  const message = error.detail;
  if (message.startsWith('denied')) return 'Denied on the desktop.';
  if (message.startsWith('approval_unavailable')) {
    return 'The bridge has no way to ask for confirmation on this system; see its log.';
  }
  if (message.startsWith('not_https')) return 'Only https:// repository URLs can be installed.';
  if (message.startsWith('clone_failed')) return `Could not clone the repository: ${message}`;
  if (message.startsWith('no_manifest')) return 'The repository has no plugin.json at its root.';
  if (message.startsWith('manifest_invalid')) return `plugin.json is invalid: ${message.slice('manifest_invalid:'.length).trim()}`;
  if (message.startsWith('policy')) return `Refused by the source policy: ${message.slice('policy:'.length).trim()}`;
  if (message.startsWith('already_installed')) return 'That plugin is already installed.';
  if (message.startsWith('unsigned')) {
    return `The repository is not signed by its author, or the signature does not match its files: ${message.slice('unsigned:'.length).trim()}`;
  }
  if (message.startsWith('not_trusted')) return 'That signing key is not one this machine trusts.';
  return message;
}

/** True for the one error the user needs a link for. */
export function isApprovalUnavailable(error: unknown): boolean {
  return error instanceof NativeRequestError && error.detail.startsWith('approval_unavailable');
}

const CONFIRMED: RequestOptions = { timeoutMs: CONFIRMED_CALL_TIMEOUT_MS };

export class PluginsService {
  readonly #call: Call;

  constructor(call: Call) {
    this.#call = call;
  }

  async install(url: string): Promise<InstalledPlugin | undefined> {
    const result = await this.#call('plugins', 'install', { url }, CONFIRMED);
    return toInstalledPlugin(isRecord(result) ? result['plugin'] : undefined);
  }

  async list(): Promise<readonly InstalledPlugin[]> {
    return toInstalledList(await this.#call('plugins', 'list', {}));
  }

  async checkUpdates(): Promise<readonly PluginUpdate[]> {
    const result = await this.#call('plugins', 'check_updates', {});
    const updates = isRecord(result) ? result['updates'] : undefined;
    if (!Array.isArray(updates)) return [];
    return updates.flatMap((entry) => {
      const update = toUpdate(entry);
      return update === undefined ? [] : [update];
    });
  }

  async update(id: PluginId): Promise<void> {
    await this.#call('plugins', 'update', { id }, CONFIRMED);
  }

  async uninstall(id: PluginId): Promise<void> {
    await this.#call('plugins', 'uninstall', { id }, CONFIRMED);
  }

  async build(): Promise<BuildResult> {
    return toBuildResult(await this.#call('plugins', 'build', {}));
  }

  async keys(): Promise<readonly TrustedKey[]> {
    const result = await this.#call('plugins', 'keys', {});
    const list = isRecord(result) ? result['keys'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry) => {
      const key = toTrustedKey(entry);
      return key === undefined ? [] : [key];
    });
  }

  async forgetKey(keyId: string): Promise<void> {
    await this.#call('plugins', 'forget_key', { keyId }, CONFIRMED);
  }
}
