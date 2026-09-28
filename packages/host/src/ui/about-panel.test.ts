/**
 * The Plugin System tab reports what is true now.
 *
 * Both tests here are regressions. The panel renders once, early — before the bridge has
 * answered `plugins/list` and before anything has been activated — so a panel that only
 * re-renders on bridge status showed "installed 0, enabled 0" for the life of the page while
 * three plugins ran. And a badge element reused across two rows is *moved* by the second
 * append, which left the first row silently empty.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import type { PluginId } from '@vrcnext/plugin-api';

import { AboutPanel, type AboutPanelDeps } from './about-panel.js';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['window'] = dom.window;
  globals['document'] = dom.window.document;
  globals['location'] = dom.window.location;
});

afterEach(() => {
  dom.window.close();
});

interface Harness {
  readonly deps: AboutPanelDeps;
  readonly notifyManager: () => void;
  /** Mutated in place: the fake manager reads this object, not a copy of it. */
  readonly state: { installed: readonly { readonly id: string }[]; enabled: readonly string[] };
}

function harness(status: 'connected' | 'disconnected' = 'connected'): Harness {
  const listeners: (() => void)[] = [];
  const state = {
    installed: [] as readonly { readonly id: string }[],
    enabled: [] as readonly string[],
  };
  const manager = {
    get compiled() { return state.installed.map((p) => ({ manifest: { id: p.id as PluginId } })); },
    get installed() { return state.installed; },
    isEnabled: (id: PluginId) => state.enabled.includes(id),
    onChange: (listener: () => void) => { listeners.push(listener); return () => undefined; },
  };
  const deps = {
    manager,
    sink: { records: [] },
    native: { status, describe: () => ({ version: '0.4.0' }), onStatus: () => () => undefined },
    debugHub: { enabled: false },
    isLinux: () => true,
    openUrl: () => undefined,
  } as unknown as AboutPanelDeps;
  return { deps, state, notifyManager: () => { for (const listener of listeners) listener(); } };
}

/** The digits in the stat strip, in the order they are shown. */
function stats(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.vrcnx-stat')].map((node) => node.querySelector('.vrcnx-stat-value')?.textContent ?? '');
}

test('counts follow the manager instead of freezing at whatever was true during the first render', () => {
  const h = harness();
  const container = dom.window.document.getElementById('host') as unknown as HTMLElement;
  new AboutPanel(h.deps).render(container);
  assert.deepEqual(stats(container).slice(0, 3), ['0', '0', '0'], 'nothing has loaded yet');

  h.state.installed = [{ id: 'bio-updater' }, { id: 'club-security' }];
  h.state.enabled = ['bio-updater'];
  h.notifyManager();
  assert.deepEqual(stats(container).slice(0, 3), ['2', '2', '1']);
});

test('every platform row gets its own badge, so none of them is left blank', () => {
  const h = harness();
  const container = dom.window.document.getElementById('host') as unknown as HTMLElement;
  new AboutPanel(h.deps).render(container);
  const rows = [...container.querySelectorAll('.sf-toggle-row')].filter((row) =>
    ['OSC', 'Desktop notifications', 'VR overlay notifications'].some((label) => row.textContent.startsWith(label)));
  assert.equal(rows.length, 3);
  for (const row of rows) assert.ok(row.querySelector('.vrcn-badge'), `${row.textContent} lost its badge`);
});
