/**
 * Sections must behave like VRCNext's own: nav items with the `onclick` attribute VRCNext reads
 * back, blocks tagged with the section id, hidden until `switchSettingsSection` shows them, and
 * nothing left behind on removal.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, test } from 'vitest';

import { SettingsNav } from './settings-section.js';

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
  const doc = dom.window.document;
  for (const el of doc.querySelectorAll<HTMLElement>('#tab9 [data-section]')) {
    el.style.display = el.dataset['section'] === id ? '' : 'none';
  }
  for (const b of doc.querySelectorAll('#tab9 .settings-nav-item')) b.classList.remove('active');
  (btn ?? doc.querySelector(`#tab9 .settings-nav-item[onclick*="'${id}'"]`))?.classList.add('active');
}

beforeEach(() => {
  // Inline `onclick` attributes run in the JSDOM window (hence runScripts), not in this module's globals.
  dom = new JSDOM(SHELL, { pretendToBeVisual: true, runScripts: 'dangerously' });
  shown = [];
  switched = [];
  const scope = globalThis as Record<string, unknown>;
  scope['document'] = dom.window.document;
  scope['showTab'] = (i: number): void => { shown.push(i); };
  scope['switchSettingsSection'] = switchSettingsSection;
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

function navChildren(): Element[] {
  return [...(dom.window.document.querySelector('#tab9 .settings-nav')?.children ?? [])];
}

test('addDivider and addSection append after VRCNext’s own items, with its onclick attribute', () => {
  const nav = new SettingsNav();
  nav.addDivider();
  const section = nav.addSection({ sectionId: 'demo.main', label: 'Demo', icon: 'science' });

  const children = navChildren();
  assert.equal(children.length, 3, 'General, divider, Demo');
  assert.equal((children[1] as HTMLElement).style.height, '1px');
  assert.equal(children[2], section.navItem);
  assert.equal(section.navItem.textContent, 'scienceDemo');
  assert.equal(section.navItem.getAttribute('onclick'), "switchSettingsSection('demo.main', this)");
});

test('attach files the block under the section, hidden while General is active', () => {
  const section = new SettingsNav().addSection({ sectionId: 's', label: 'S', icon: 'tune' });
  const a = card('A');
  section.attach(a);

  const content = dom.window.document.querySelector('#tab9 .settings-content');
  assert.ok(content);
  assert.equal(a.parentElement, content);
  assert.equal(a.dataset['section'], 's');
  assert.equal(a.style.display, 'none');
});

test('the nav item drives VRCNext’s own section switch through its onclick attribute', () => {
  const section = new SettingsNav().addSection({ sectionId: 's', label: 'S', icon: 'tune' });
  const a = card('A');
  section.attach(a);
  section.navItem.click();

  assert.deepEqual(switched, ['s']);
  assert.equal(a.style.display, '');
  assert.equal(dom.window.document.querySelector<HTMLElement>('[data-section="general"]')?.style.display, 'none');
  assert.equal(section.isActive(), true);
});

test('a block attached while its section is active is visible at once', () => {
  const section = new SettingsNav().addSection({ sectionId: 's', label: 'S', icon: 'tune' });
  section.navItem.click();
  const b = card('B');
  section.attach(b);
  assert.equal(b.style.display, '');
});

test('open shows the Settings tab, switches the section and scrolls to the block', () => {
  const section = new SettingsNav().addSection({ sectionId: 's', label: 'S', icon: 'tune' });
  const a = card('A');
  let scrolled = false;
  a.scrollIntoView = (): void => { scrolled = true; };
  section.attach(a);

  section.open(a);

  assert.deepEqual(shown, [1], 'tab9 is the second .tab in this shell');
  assert.deepEqual(switched, ['s']);
  assert.ok(scrolled);
});

test('remove takes the nav item and every block with it, and falls back to General if active', () => {
  const nav = new SettingsNav();
  const divider = nav.addDivider();
  const section = nav.addSection({ sectionId: 's', label: 'S', icon: 'tune' });
  section.attach(card('A'));
  section.attach(card('B'));
  section.navItem.click();

  section.remove();
  divider.remove();

  assert.equal(navChildren().length, 1, 'only General is left');
  assert.equal(dom.window.document.querySelectorAll('[data-section="s"]').length, 0);
  assert.deepEqual(switched, ['s', 'general']);
  assert.equal(dom.window.document.querySelector<HTMLElement>('[data-section="general"]')?.style.display, '');
});

test('removing an inactive section does not switch anything', () => {
  const section = new SettingsNav().addSection({ sectionId: 's', label: 'S', icon: 'tune' });
  section.attach(card('A'));
  section.remove();
  assert.deepEqual(switched, []);
});
