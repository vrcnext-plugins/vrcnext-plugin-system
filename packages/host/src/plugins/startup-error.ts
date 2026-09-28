/**
 * A plugin that failed on the way up, with somewhere to send it.
 *
 * A plain `Error` reaches the log and nothing else. This one carries the manifest and, where
 * the plugin names a GitHub homepage, a prefilled report — so the UI can offer the one action
 * that helps rather than a sentence the user can only read.
 */

import type { PluginManifest } from '@vrcnext/plugin-api';

import type { IssueReport } from './report-issue.js';

export class PluginStartupError extends Error {
  readonly manifest: PluginManifest;
  /** Absent when the plugin names no repository the host can build a link for. */
  report?: IssueReport;

  constructor(message: string, manifest: PluginManifest, cause: Error) {
    super(message, { cause });
    this.name = 'PluginStartupError';
    this.manifest = manifest;
  }
}
