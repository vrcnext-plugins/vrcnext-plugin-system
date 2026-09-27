/**
 * The Plugins section must behave like one of VRCNext's own: a nav item, cards tagged with the
 * section id, hidden until `switchSettingsSection` shows them.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { SECTION_ID, SettingsSection } from './settings-section.js';

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

/** A faithful copy of VRCNext's `switchSettingsSection`: toggles cards and the active nav item. */
function switchSettingsSection(id: string, btn: HTMLElement | null): void {
  switched.push(id);
  for (const el of dom.window.document.querySelectorAll<HTMLElement>('#tab9 [data-section]')) {
    el.style.display = el.dataset['section'] === id ? '' : 'none';
  }
  for (const b of dom.window.document.querySelectorAll('#tab9 .settings-nav-item')) b.classList.remove('active');
  btn?.classList.add('active');
}

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true });
  shown = [];
  switched = [];
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['showTab'] = (i: number): void => { shown.push(i); };
  scope['switchSettingsSection'] = switchSettingsSection;
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

test('attach adds one nav item and files the card under the plugins section, hidden', () => {
  const section = new SettingsSection();
  section.attach(card('A'));
  section.attach(card('B'));

  const items = dom.window.document.querySelectorAll('#tab9 .settings-nav-item');
  assert.equal(items.length, 2, 'one VRCNext item plus ours');
  assert.equal(items[1]?.textContent, 'extensionPlugins');

  const cards = dom.window.document.querySelectorAll<HTMLElement>(`#tab9 .settings-content [data-section="${SECTION_ID}"]`);
  assert.equal(cards.length, 2);
  assert.ok(cards[0]?.style.display === 'none', 'hidden while General is the active section');
  assert.equal(dom.window.document.querySelector('[data-section="general"]')?.parentElement, cards[0].parentElement);
});

test('the nav item drives VRCNext’s own section switch', () => {
  const section = new SettingsSection();
  const a = card('A');
  section.attach(a);
  const item = dom.window.document.querySelector<HTMLElement>('#tab9 .settings-nav-item[data-vrcnext-plugin-host]');
  assert.ok(item !== null);
  item.click();

  assert.deepEqual(switched, [SECTION_ID]);
  assert.equal(a.style.display, '');
  assert.equal(dom.window.document.querySelector<HTMLElement>('[data-section="general"]')?.style.display, 'none');
  assert.equal(item.classList.contains('active'), true);
});

test('a card attached while the section is active is visible at once', () => {
  const section = new SettingsSection();
  section.attach(card('A'));
  dom.window.document.querySelector<HTMLElement>('#tab9 .settings-nav-item[data-vrcnext-plugin-host]')?.click();
  const b = card('B');
  section.attach(b);
  assert.equal(b.style.display, '');
});

test('open shows the Settings tab, switches the section and scrolls to the card', () => {
  const section = new SettingsSection();
  const a = card('A');
  let scrolled = false;
  a.scrollIntoView = (): void => { scrolled = true; };
  section.attach(a);

  section.open(a);

  assert.deepEqual(shown, [1], 'tab9 is the second .tab in this shell');
  assert.deepEqual(switched, [SECTION_ID]);
  assert.ok(scrolled);
});

test('unmount removes the nav item and mount adds it back once', () => {
  const section = new SettingsSection();
  section.mount();
  section.mount();
  assert.equal(dom.window.document.querySelectorAll('[data-vrcnext-plugin-host="settings-nav"]').length, 1);
  section.unmount();
  assert.equal(dom.window.document.querySelectorAll('[data-vrcnext-plugin-host="settings-nav"]').length, 0);
});
