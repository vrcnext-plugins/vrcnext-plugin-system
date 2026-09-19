/**
 * Verifies the injected markup matches VRCNext's own structure, and that both surfaces survive
 * the two things VRCNext does that would otherwise break them: `navRender()` clearing `#navEl`,
 * and the taskbar binding its listeners before our menu exists.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { PluginNav, type NavEntry } from './plugin-nav.js';

/** Mirrors the parts of VRCNext's shell this code touches. */
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
let nav: PluginNav;
let shown: number[];
let renders: string[];

function entries(): readonly NavEntry[] {
  return [
    { id: 'manage', label: 'Manage Plugins', icon: 'extension', render: (c) => { renders.push('manage'); c.textContent = 'manage'; } },
    { id: 'logs', label: 'Logs', icon: 'article', render: (c) => { renders.push('logs'); c.textContent = 'logs'; } },
    { id: 'system', label: 'Plugin System', icon: 'settings_applications', render: (c) => { renders.push('system'); c.textContent = 'system'; } },
  ];
}

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true });
  shown = [];
  renders = [];

  // The host reads document/MutationObserver/showTab off the global, exactly as it does in the
  // real page; point them at the JSDOM window for the duration of the test.
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['MutationObserver'] = dom.window.MutationObserver;
  scope['showTab'] = (i: number): void => { shown.push(i); };

  nav = new PluginNav({
    entries: entries(),
    groupId: 'vrcnextPluginsNavGroup',
    groupLabel: 'Plugins',
    groupIcon: 'extension',
    onError: (error) => { throw error; },
  });
  nav.mount();
});

afterEach(() => {
  nav.dispose();
  dom.window.close();
});

function q(selector: string): Element | null {
  return dom.window.document.querySelector(selector);
}

test('adds a sidebar separator and a Plugins group using VRCNext classes', () => {
  const sep = q('#navEl .nav-sep');
  assert.ok(sep, 'separator missing');
  assert.equal(sep.querySelector('.nav-sep-label.nl')?.textContent, 'Plugins');

  const group = q('#navEl .nav-group#vrcnextPluginsNavGroup');
  assert.ok(group, 'group missing');
  const header = group.querySelector('.nav-btn.nav-group-btn');
  assert.ok(header, 'group header missing');
  assert.equal(header.querySelector('.ni.msi')?.textContent, 'extension');
  assert.equal(header.querySelector('.nl')?.textContent, 'Plugins');
  assert.equal(header.querySelector('.nav-group-arrow')?.textContent, 'expand_more');
});

test('renders one nav-sub item per entry, in order', () => {
  const items = [...dom.window.document.querySelectorAll('#navEl .nav-group-items .nav-btn.nav-sub')];
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.querySelector('.nl')?.textContent),
    ['Manage Plugins', 'Logs', 'Plugin System'],
  );
  assert.deepEqual(
    items.map((i) => i.querySelector('.ni.msi')?.textContent),
    ['extension', 'article', 'settings_applications'],
  );
});

test('the group header toggles collapsed without VRCNext’s layout store', () => {
  const group = q('#vrcnextPluginsNavGroup');
  const header = group?.querySelector('.nav-group-btn');
  assert.ok(group && header);

  assert.equal(group.classList.contains('collapsed'), false);
  (header as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(group.classList.contains('collapsed'), true);
  (header as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(group.classList.contains('collapsed'), false);
});

test('mirrors the group into the top menu bar', () => {
  const menus = [...dom.window.document.querySelectorAll('#tbMenuItems .tb-menu-item')];
  const mine = menus.at(-1);
  assert.ok(mine);
  assert.equal(mine.querySelector('span')?.textContent, 'Plugins');
  assert.ok(q('#tbMenuItems .tb-sep'), 'taskbar separator missing');

  const items = [...mine.querySelectorAll('.tb-dropdown .tb-dd-item')];
  assert.deepEqual(
    items.map((i) => i.querySelectorAll('span')[1]?.textContent),
    ['Manage Plugins', 'Logs', 'Plugin System'],
  );
});

test('creates one tab per entry and renders it lazily on first activation', () => {
  assert.equal(dom.window.document.querySelectorAll('.tab').length, 4); // VRCNext's tab0 + 3
  assert.deepEqual(renders, [], 'nothing should render before activation');

  const logs = q('#navEl .nav-group-items .nav-btn.nav-sub:nth-child(2)');
  (logs as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(renders, ['logs']);
  assert.deepEqual(shown, [2]); // tab index: tab0, manage, logs

  (logs as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(renders, ['logs'], 'second activation must not re-render');
  assert.deepEqual(shown, [2, 2]);
});

test('the taskbar item activates the same shared tab', () => {
  const ddItem = q('#tbMenuItems .tb-menu-item:last-child .tb-dd-item');
  (ddItem as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(renders, ['manage']);
  assert.deepEqual(shown, [1]);
});

test('re-attaches after navRender() clears #navEl', async () => {
  const navEl = q('#navEl');
  assert.ok(navEl);
  navEl.innerHTML = '';
  assert.equal(navEl.querySelector('.nav-group'), null);

  // MutationObserver callbacks are microtask-scheduled.
  await Promise.resolve();
  assert.ok(navEl.querySelector('.nav-sep'), 'separator not restored');
  assert.ok(navEl.querySelector('#vrcnextPluginsNavGroup'), 'group not restored');
});

test('dispose removes everything it injected', () => {
  nav.dispose();
  assert.equal(q('#navEl .nav-sep'), null);
  assert.equal(q('#vrcnextPluginsNavGroup'), null);
  assert.equal(q('#tbMenuItems .tb-sep'), null);
  assert.equal(dom.window.document.querySelectorAll('.tab').length, 1);
});
