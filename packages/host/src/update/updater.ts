/**
 * Auto-update for plugins and for the host itself.
 *
 * Plugins update in place: the registry re-reads the repo manifest, and any plugin whose
 * manifest version is newer than the installed one is re-downloaded and, if it was running,
 * restarted. The bundle is stored in IndexedDB, so no filesystem write is needed.
 *
 * The **host** cannot update itself the same way — it is a file in VRCNext's theme folder and
 * the page cannot write there. So the host only *detects* a newer release and tells the user
 * what to run. Claiming otherwise would be a lie dressed as a feature.
 */

import { compareVersions } from 'compare-versions';

import { API_VERSION } from '../api-version.js';
import type { Logger } from '@vrcnext/plugin-api';
import type { PluginManager } from '../plugin-manager.js';

/** Checked on boot and then on this interval. */
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const HOST_RELEASES_URL =
  'https://api.github.com/repos/vrcnext-plugins/vrcnext-plugin-system/releases/latest';

export interface PluginUpdate {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

export interface UpdateReport {
  readonly updated: readonly PluginUpdate[];
  readonly failures: readonly string[];
  readonly hostUpdate: string | undefined;
}

export interface UpdaterDeps {
  readonly manager: PluginManager;
  readonly logger: Logger;
  readonly notify: (message: string, ok: boolean) => void;
}

export class Updater {
  readonly #deps: UpdaterDeps;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: UpdaterDeps) {
    this.#deps = deps;
  }

  /** Runs one check now, then repeats on {@link UPDATE_INTERVAL_MS}. */
  start(signal: AbortSignal): void {
    if (this.#timer !== undefined) return;
    void this.#runSafely();
    this.#timer = setInterval(() => { void this.#runSafely(); }, UPDATE_INTERVAL_MS);
    signal.addEventListener('abort', () => { this.stop(); }, { once: true });
  }

  stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #runSafely(): Promise<void> {
    try {
      const report = await this.check();
      this.#announce(report);
    } catch (error) {
      this.#deps.logger.warn(
        `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #announce(report: UpdateReport): void {
    for (const update of report.updated) {
      this.#deps.logger.info(`Updated ${update.name} ${update.from} → ${update.to}.`);
    }
    if (report.updated.length > 0) {
      const names = report.updated.map((u) => u.name).join(', ');
      this.#deps.notify(`Updated ${names}.`, true);
    }
    for (const failure of report.failures) this.#deps.logger.warn(failure);
    if (report.hostUpdate !== undefined) {
      this.#deps.notify(
        `Plugin system ${report.hostUpdate} is available. Run scripts/install-into-vrcnext.sh to update.`,
        true,
      );
    }
  }

  /** Refreshes every repository, updates outdated plugins, and checks for a host release. */
  async check(): Promise<UpdateReport> {
    const updated: PluginUpdate[] = [];
    const failures: string[] = [];

    for (const repo of this.#deps.manager.repos) {
      try {
        await this.#deps.manager.refreshRepo(repo.id);
      } catch (error) {
        failures.push(
          `Could not refresh ${repo.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      await this.#updateRepoPlugins(repo.id, updated, failures);
    }

    return { updated, failures, hostUpdate: await this.#checkHost() };
  }

  async #updateRepoPlugins(
    repoId: PluginManager['repos'][number]['id'],
    updated: PluginUpdate[],
    failures: string[],
  ): Promise<void> {
    const repo = this.#deps.manager.repos.find((candidate) => candidate.id === repoId);
    if (repo === undefined) return;

    for (const manifest of repo.plugins) {
      const installed = this.#deps.manager.findInstalled(repoId, manifest.id);
      if (installed === undefined) continue;
      if (!isNewer(manifest.version, installed.manifest.version)) continue;

      try {
        await this.#deps.manager.reinstallPlugin(installed.key);
        updated.push({
          name: manifest.name,
          from: installed.manifest.version,
          to: manifest.version,
        });
      } catch (error) {
        failures.push(
          `Could not update ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Returns the newer host version tag, or undefined when current. */
  async #checkHost(): Promise<string | undefined> {
    try {
      const response = await fetch(HOST_RELEASES_URL, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) return undefined;
      const tag = (body as { tag_name?: unknown }).tag_name;
      if (typeof tag !== 'string') return undefined;
      const latest = tag.replace(/^v/, '');
      return isNewer(latest, API_VERSION) ? latest : undefined;
    } catch {
      // A missing releases endpoint (no release cut yet) is not an error worth surfacing.
      return undefined;
    }
  }
}

/** True when `candidate` is a valid semver strictly newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  try {
    return compareVersions(candidate, current) > 0;
  } catch {
    // A non-semver version string is a plugin-authoring mistake, not grounds for an update.
    return false;
  }
}
