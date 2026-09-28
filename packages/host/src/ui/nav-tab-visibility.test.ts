/**
 * A plugin's tab knows whether the user is looking at it.
 *
 * VRCNext shows one tab at a time by moving an `active` class, and it does that from its own
 * sidebar as well as from ours, so the host watches the attribute rather than only reporting
 * what the plugin itself asked for.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { UiHost } from './ui-host.js';

const SHELL = `<!doctype html><html><body>
  <div class="sidebar" id="sidebarEl"><div class="nav" id="navEl">
    <button class="nav-btn" onclick="showTab(0)"><span class="ni msi">dashboard</span><span class="nl">Dashboard</span></button>
  </div></div>
  <div class="main"><div id="taskbar"><div id="tb-left"><div id="tbMenuItems">
    <div class="tb-menu-item" id="tbMenuApp"><span>App</span><div class="tb-dropdown"></div></div>
  </div></div></div>
  <div class="content"><div class="tab active" id="tab0"></div></div></div>
</body></html>`;

let dom: JSDOM;
let host: UiHost;

/** Stands in for VRCNext's showTab: it only moves the class, which is what the host reads. */
function showTab(index: number): void {
  dom.window.document.querySelectorAll('.tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
  });
}

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true });
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['MutationObserver'] = dom.window.MutationObserver;
  scope['showTab'] = showTab;
  host = new UiHost({ toast: () => undefined, vrchat: {} as never });
});

afterEach(() => { dom.window.close(); });

function ui(): ReturnType<UiHost['forPlugin']> {
  return host.forPlugin({ id: 'club-security', name: 'Club Security', vrchat: {} as never, bag: { add: () => undefined } as never });
}

/** MutationObserver callbacks are microtasks; let them run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('a tab is invisible until it is shown, and hears every switch', async () => {
  const seen: boolean[] = [];
  const panel = ui().addNavTab({
    label: 'Club Security',
    icon: 'security',
    render: () => undefined,
    onVisibility: (visible) => { seen.push(visible); },
  });
  assert.equal(panel.visible, false, 'a tab nobody opened is not visible');

  const index = [...dom.window.document.querySelectorAll('.tab')].indexOf(panel.element);
  showTab(index);
  await settle();
  assert.equal(panel.visible, true);

  // VRCNext's own tab, chosen from its own sidebar.
  showTab(0);
  await settle();
  assert.equal(panel.visible, false);
  assert.deepEqual(seen, [true, false]);
});

test('a throwing listener does not break the host', async () => {
  const panel = ui().addNavTab({
    label: 'Club Security',
    icon: 'security',
    render: () => undefined,
    onVisibility: () => { throw new Error('nope'); },
  });
  const errors: unknown[] = [];
  const console = globalThis.console;
  globalThis.console = { ...console, error: (...args: unknown[]) => { errors.push(args); } };
  try {
    showTab([...dom.window.document.querySelectorAll('.tab')].indexOf(panel.element));
    await settle();
  } finally {
    globalThis.console = console;
  }
  assert.equal(panel.visible, true, 'the state is still right');
  assert.equal(errors.length, 1, 'and the failure was reported');
});

test('a stylesheet is never visible', () => {
  assert.equal(ui().injectCss('.x{}').visible, false);
});
