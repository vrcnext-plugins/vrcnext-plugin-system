/**
 * The dialog shown when a plugin did not start.
 *
 * A toast saying "1 plugin(s) failed to start" is a notification that something is wrong and no
 * way to do anything about it. This says which plugin, what it was written for, what this host
 * provides, and offers the one action that helps: a prefilled issue on the plugin's own
 * repository.
 */

import { PluginStartupError } from '../plugins/startup-error.js';
import { element } from './dom.js';
import { showModal } from './modal.js';
import { description } from './widgets.js';

/** Fallback for a plugin that failed without naming a repository. */
const NO_REPORT = 'This plugin names no repository, so there is nowhere to send a report.';

export interface FailureDialogDeps {
  readonly openUrl: (url: string) => void;
}

/**
 * Show one dialog covering everything that failed to start.
 *
 * Errors that are not {@link PluginStartupError} still belong here — they are just as much a
 * plugin that did not start — they simply carry no manifest and no link.
 */
export async function showStartupFailures(
  failures: readonly Error[],
  deps: FailureDialogDeps,
): Promise<void> {
  if (failures.length === 0) return;
  const reportable = failures.filter(
    (failure): failure is PluginStartupError =>
      failure instanceof PluginStartupError && failure.report !== undefined,
  );

  const body = failures.map((failure) => {
    const block = element('div');
    block.style.cssText = 'margin-bottom:8px;';
    block.appendChild(description(failure.message));
    const cause = failure.cause;
    if (cause instanceof Error) {
      const detail = element('pre', undefined, cause.message);
      block.appendChild(detail);
    }
    if (failure instanceof PluginStartupError && failure.report === undefined) {
      block.appendChild(description(NO_REPORT));
    }
    return block;
  });

  const choice = await showModal<string>({
    title: failures.length === 1 ? 'A plugin did not start' : `${String(failures.length)} plugins did not start`,
    icon: 'extension_off',
    body: [
      description(
        'VRCNext and its plugins are unaffected; only these did not come up. A plugin written ' +
          'for an older host usually still works, so this is worth reporting rather than waiting on.',
      ),
      ...body,
    ],
    buttons: [
      ...reportable.map((failure) => ({
        label: reportable.length === 1 ? 'Report to the author' : `Report ${failure.manifest.name}`,
        icon: 'bug_report',
        value: failure.manifest.id,
      })),
      { label: 'Close', icon: 'close', value: '' },
    ],
  });

  const chosen = reportable.find((failure) => failure.manifest.id === choice);
  if (chosen?.report !== undefined) deps.openUrl(chosen.report.url);
}
