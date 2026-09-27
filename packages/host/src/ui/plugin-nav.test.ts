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
let activated: string[];
let errors: string[];

function entries(): readonly NavEntry[] {
  return [
    { id: 'system', label: 'Plugin System', icon: 'tune', activate: () => { activated.push('system'); } },
    { id: 'plugins', label: 'Plugins', icon: 'extension', activate: () => { activated.push('plugins'); } },
    { id: 'broken', label: 'Broken', icon: 'bug_report', activate: () => { throw new Error('nope'); } },
  ];
}

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true });
  shown = [];
  activated = [];
  errors = [];

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
    onError: (error, entry) => { errors.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`); },
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

test('adds one nav-sub item per entry, in order', () => {
  const items = [...dom.window.document.querySelectorAll('#navEl .nav-group-items .nav-btn.nav-sub')];
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.querySelector('.nl')?.textContent),
    ['Plugin System', 'Plugins', 'Broken'],
  );
  assert.deepEqual(
    items.map((i) => i.querySelector('.ni.msi')?.textContent),
    ['tune', 'extension', 'bug_report'],
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
    ['Plugin System', 'Plugins', 'Broken'],
  );
});

test('entries are shortcuts: no tab is created and the item only runs the entry', () => {
  assert.equal(dom.window.document.querySelectorAll('.tab').length, 1, 'only VRCNext’s own tab');

  const plugins = q('#navEl .nav-group-items .nav-btn.nav-sub:nth-child(2)');
  (plugins as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  (plugins as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(activated, ['plugins', 'plugins']);
  assert.deepEqual(shown, [], 'the shortcut decides what to show');
});

test('a shortcut that throws is reported through onError', () => {
  const broken = q('#navEl .nav-group-items .nav-btn.nav-sub:nth-child(3)');
  (broken as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(errors, ['broken: nope']);
});

test('the taskbar item runs the same entry', () => {
  const ddItem = q('#tbMenuItems .tb-menu-item:last-child .tb-dd-item');
  (ddItem as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(activated, ['system']);
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

test('opens popout in modern-folders mode and activates tab on cell click', () => {
  const navEl = q('#navEl');
  navEl?.classList.add('modern-folders');

  const group = q('#vrcnextPluginsNavGroup');
  const header = group?.querySelector('.nav-group-btn');
  assert.ok(header);

  // Click header to open popout
  (header as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const popout = q('#navFolderPopout');
  assert.ok(popout, 'modern folder popout missing');
  assert.equal(popout.querySelector('.nav-folder-popout-title')?.textContent, 'Plugins');

  const cells = [...popout.querySelectorAll('.nav-folder-cell')];
  assert.equal(cells.length, 3);
  assert.equal(cells[1]?.querySelector('.nav-folder-cell-label')?.textContent, 'Plugins');

  (cells[1] as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(activated, ['plugins']);
  assert.equal(q('#navFolderPopout'), null, 'popout should close after item click');
});

test('dispose removes everything it injected', () => {
  nav.dispose();
  assert.equal(q('#navEl .nav-sep'), null);
  assert.equal(q('#vrcnextPluginsNavGroup'), null);
  assert.equal(q('#tbMenuItems .tb-sep'), null);
});
