/**
 * The host's sections must behave like VRCNext's own: nav items with the `onclick` attribute
 * VRCNext reads back, blocks tagged with the section id, hidden until `switchSettingsSection`
 * shows them.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { PLUGINS_SECTION, SYSTEM_SECTION, SettingsSections } from './settings-section.js';

/** The parts of VRCNext's settings page this code touches. */
const SHELL = `<!doctype html><html><body>
  <div class="content">
    <div class="tab active" id="tab0"></div>
    <div class="tab" id="tab9"><div class="settings-layout">
      <nav class="settings-nav">
        <button class="settings-nav-item active" onclick="switchSettingsSection('general',this)"><span class="msi">tune</span><span>General</span></button>
      </nav>
      <div class="settings-content">
        <div class="vrcn-panel-card" data-section="general">General card</div>
      </div>
    </div></div>
  </div>
</body></html>`;

let dom: JSDOM;
let shown: number[];
let switched: string[];

/** A faithful copy of VRCNext's `switchSettingsSection`: toggles blocks and the active nav item. */
function switchSettingsSection(id: string, btn: HTMLElement | null): void {
  switched.push(id);
  for (const el of dom.window.document.querySelectorAll<HTMLElement>('#tab9 [data-section]')) {
    el.style.display = el.dataset['section'] === id ? '' : 'none';
  }
  for (const b of dom.window.document.querySelectorAll('#tab9 .settings-nav-item')) b.classList.remove('active');
  btn?.classList.add('active');
}

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true, runScripts: 'dangerously' });
  shown = [];
  switched = [];
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['showTab'] = (i: number): void => { shown.push(i); };
  scope['switchSettingsSection'] = switchSettingsSection;
  // Inline `onclick` attributes run in the JSDOM window (hence runScripts), not in this module's globals.
  (dom.window as unknown as Record<string, unknown>)['switchSettingsSection'] = switchSettingsSection;
});

afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  delete scope['document'];
  delete scope['showTab'];
  delete scope['switchSettingsSection'];
});

function card(text: string): HTMLElement {
  const el = dom.window.document.createElement('div');
  el.className = 'vrcn-panel-card';
  el.textContent = text;
  return el;
}

function navItem(section: string): HTMLElement {
  const item = dom.window.document.querySelector<HTMLElement>(`#tab9 .settings-nav-item[data-vrcnext-plugin-host="settings-nav-${section}"]`);
  assert.ok(item !== null, `nav item for ${section}`);
  return item;
}

test('mount adds a divider and the two nav items after VRCNext’s own, once', () => {
  const sections = new SettingsSections();
  sections.mount();
  sections.mount();

  const nav = dom.window.document.querySelector('#tab9 .settings-nav');
  assert.ok(nav);
  const children = [...nav.children];
  assert.equal(children.length, 4, 'General, divider, Plugin System, Plugins');
  assert.equal(children[1]?.getAttribute('data-vrcnext-plugin-host'), 'settings-divider');
  assert.equal(children[2]?.textContent, 'tunePlugin System');
  assert.equal(children[3]?.textContent, 'extensionPlugins');
  assert.equal(children[3].getAttribute('onclick'), "switchSettingsSection('plugins', this)");
});

test('attach files the block under its section, hidden while General is active', () => {
  const sections = new SettingsSections();
  sections.attach(PLUGINS_SECTION, card('A'));
  sections.attach(SYSTEM_SECTION, card('S'));

  const content = dom.window.document.querySelector("#tab9 .settings-content");
  assert.ok(content);
  const a = content.querySelector<HTMLElement>(`[data-section="${PLUGINS_SECTION}"]`);
  const s = content.querySelector<HTMLElement>(`[data-section="${SYSTEM_SECTION}"]`);
  assert.equal(a?.style.display, 'none');
  assert.equal(s?.style.display, 'none');
  assert.equal(a.parentElement, content);
});

test('the nav item drives VRCNext’s own section switch through its onclick attribute', () => {
  const sections = new SettingsSections();
  const a = card('A');
  sections.attach(PLUGINS_SECTION, a);
  navItem(PLUGINS_SECTION).click();

  assert.deepEqual(switched, [PLUGINS_SECTION]);
  assert.equal(a.style.display, '');
  assert.equal(dom.window.document.querySelector<HTMLElement>('[data-section="general"]')?.style.display, 'none');
  assert.equal(sections.isActive(PLUGINS_SECTION), true);
  assert.equal(sections.isActive(SYSTEM_SECTION), false);
});

test('a block attached while its section is active is visible at once', () => {
  const sections = new SettingsSections();
  sections.attach(SYSTEM_SECTION, card('S'));
  navItem(SYSTEM_SECTION).click();
  const b = card('B');
  sections.attach(SYSTEM_SECTION, b);
  assert.equal(b.style.display, '');
});

test('open shows the Settings tab, switches the section and scrolls to the block', () => {
  const sections = new SettingsSections();
  const a = card('A');
  let scrolled = false;
  a.scrollIntoView = (): void => { scrolled = true; };
  sections.attach(PLUGINS_SECTION, a);

  sections.open(PLUGINS_SECTION, a);

  assert.deepEqual(shown, [1], 'tab9 is the second .tab in this shell');
  assert.deepEqual(switched, [PLUGINS_SECTION]);
  assert.ok(scrolled);
});

test('unmount removes the divider and the items', () => {
  const sections = new SettingsSections();
  sections.mount();
  sections.unmount();
  assert.equal(dom.window.document.querySelectorAll('#tab9 .settings-nav > *').length, 1);
});
