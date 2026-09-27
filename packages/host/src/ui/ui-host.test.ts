/**
 * The plugin-facing UI API for sections, dividers and sidebar groups: ids are namespaced per
 * plugin, cards default to the host's Plugins section, and disposing the bag removes everything.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { DisposableBag, type VrchatApi } from '@vrcnext/plugin-api';

import { UiHost } from './ui-host.js';

/** The pickers are not exercised here; nothing may reach VRChat data. */
const noVrchat = new Proxy({}, { get: () => () => { throw new Error('no VRChat data in this test'); } }) as VrchatApi;

const SHELL = `<!doctype html><html><body>
  <div class="sidebar" id="sidebarEl"><div class="nav" id="navEl"></div></div>
  <div class="main"><div id="taskbar"><div id="tb-left"><div id="tbMenuItems"></div></div></div></div>
  <div class="content">
    <div class="tab active" id="tab0"></div>
    <div class="tab" id="tab9"><div class="settings-layout">
      <nav class="settings-nav">
        <button class="settings-nav-item active" onclick="switchSettingsSection('general',this)"><span>General</span></button>
      </nav>
      <div class="settings-content"><div data-section="general">General</div></div>
    </div></div>
  </div>
</body></html>`;

let dom: JSDOM;
let switched: string[];

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true });
  switched = [];
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['MutationObserver'] = dom.window.MutationObserver;
  scope['showTab'] = (): void => undefined;
  scope['switchSettingsSection'] = (id: string): void => { switched.push(id); };
});

afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  delete scope['document'];
  delete scope['MutationObserver'];
  delete scope['showTab'];
  delete scope['switchSettingsSection'];
});

function host(): UiHost {
  return new UiHost({ toast: () => undefined, vrchat: noVrchat });
}

test('the host’s ids are the page’s own; a plugin’s are namespaced', () => {
  const ui = host();
  const hostBag = new DisposableBag();
  const plugins = ui.forHost(hostBag).addSettingsSection({ id: 'plugins', label: 'Plugins', icon: 'extension' });
  const mine = ui.forPlugin({ id: 'demo', name: 'Demo', bag: new DisposableBag() }).addSettingsSection({ id: 'main', label: 'Demo', icon: 'science' });

  assert.equal(plugins.sectionId, 'plugins');
  assert.equal(mine.sectionId, 'demo.main');
  assert.equal(mine.element.getAttribute('data-vrcnext-plugin'), 'demo');
  assert.equal(mine.element.getAttribute('onclick'), "switchSettingsSection('demo.main', this)");
});

test('a plugin’s settings card goes into a section of its own, named after it', () => {
  const ui = host();
  const pluginUi = ui.forPlugin({ id: 'demo', name: 'Demo', bag: new DisposableBag() });

  const defaulted = pluginUi.addSettingsCard({ title: 'Default', icon: 'tune' });
  assert.equal(defaulted.element.dataset['section'], 'demo.settings');
  const nav = dom.window.document.querySelector('.settings-nav-item[onclick*="demo.settings"]');
  assert.equal(nav?.textContent, 'tuneDemo', 'the nav item carries the plugin’s name and its card’s icon');

  // A second card joins the same section rather than making another.
  const second = pluginUi.addSettingsCard({ title: 'More', icon: 'tune' });
  assert.equal(second.element.dataset['section'], 'demo.settings');

  const own = pluginUi.addSettingsSection({ id: 'main', label: 'Demo', icon: 'science' });
  const filed = pluginUi.addSettingsCard({ title: 'Filed', icon: 'tune', section: own });
  assert.equal(filed.element.dataset['section'], 'demo.main');

  assert.equal(ui.settingsCardOf('demo'), filed.element, 'the Settings button finds the plugin’s newest card');
  assert.equal(ui.openSettingsOf('demo'), true);
  assert.equal(ui.openSettingsOf('absent'), false);
});

test('the divider above the plugin sections is hidden while no plugin has any', () => {
  const ui = host();
  const divider = ui.forHost(new DisposableBag()).addSettingsDivider();
  ui.setPluginDivider(divider.element);
  assert.equal(divider.element.style.display, 'none');

  const bag = new DisposableBag();
  ui.forPlugin({ id: 'demo', name: 'Demo', bag }).addSettingsCard({ title: 'Default', icon: 'tune' });
  assert.equal(divider.element.style.display, '');

  bag.dispose();
  assert.equal(divider.element.style.display, 'none');
});

test('disposing the plugin’s bag removes its section, divider, blocks and sidebar group', () => {
  const ui = host();
  const bag = new DisposableBag();
  const pluginUi = ui.forPlugin({ id: 'demo', name: 'Demo', bag });
  pluginUi.addSettingsDivider();
  const section = pluginUi.addSettingsSection({ id: 'main', label: 'Demo', icon: 'science' });
  const block = dom.window.document.createElement('div');
  section.attach(block);
  pluginUi.addSidebarGroup({
    id: 'group',
    label: 'Demo',
    icon: 'science',
    entries: [{ id: 'open', label: 'Open', icon: 'science', activate: () => { section.open(); } }],
  });

  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('[data-vrcnext-plugin="demo"]').length, 4, 'divider, nav item, block, group');
  assert.ok(doc.getElementById('demo.group'), 'group id is namespaced');
  assert.equal(block.getAttribute('data-vrcnext-plugin'), 'demo');

  doc.querySelector<HTMLElement>('#demo\\.group .nav-sub')?.click();
  assert.deepEqual(switched, ['demo.main'], 'the shortcut opened the section');

  bag.dispose();
  assert.equal(doc.querySelectorAll('[data-vrcnext-plugin="demo"]').length, 0);
  assert.equal(doc.querySelectorAll('#navEl > *').length, 0, 'sidebar separator gone too');
  assert.equal(doc.querySelectorAll('#tbMenuItems > *').length, 0, 'menu gone too');
});
