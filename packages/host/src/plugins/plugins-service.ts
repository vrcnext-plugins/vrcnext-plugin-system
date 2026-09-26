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
 *
 * Pushes: `progress {op, id, step, message}`, `build BuildResult`, `plugins {plugins}`.
 *
 * `install`, `update` and `uninstall` are confirmed by the bridge on the desktop before they
 * run, so those three calls wait far longer than a local round trip. Their errors are
 * `bad_request` with a stable code at the front of the message; {@link describeError} turns the
 * ones a user can act on into sentences.
 */

import type { PluginId } from '@vrcnext/plugin-api';

import { NativeRequestError, type RequestOptions } from '../capabilities/native.js';

/** How long a desktop confirmation may take, plus the clone or fetch behind it. */
export const CONFIRMED_CALL_TIMEOUT_MS = 130_000;

/** A `progress` push while the bridge waits for the user to confirm on the desktop. */
export const STEP_AWAITING_CONFIRMATION = 'awaiting_confirmation';

export const BRIDGE_DOCS_URL = 'https://github.com/vrcnext-plugins/vrcnext-bridge#readme';

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
}
