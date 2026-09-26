/**
 * Markup here mirrors what VRCNext actually renders (read out of its frontend), so a change in
 * how it carries ids shows up as a failing case rather than as a silently empty `target.entity`.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'vitest';

import { resolveEntity } from './entity-resolver.js';

const USER = 'usr_0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8';
const WORLD = 'wrld_1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809';
const AVATAR = 'avtr_2b3c4d5e-6f70-8192-a3b4-c5d6e7f8091a';
const GROUP = 'grp_3c4d5e6f-7081-92a3-b4c5-d6e7f8091a2b';
const LOCATION = `${WORLD}:12345~private(${USER})~region(eu)`;

function target(html: string): HTMLElement {
  const dom = new JSDOM(`<body>${html}</body>`);
  const el = dom.window.document.querySelector<HTMLElement>('#target');
  assert.ok(el !== null, 'fixture needs an #target element');
  return el;
}

test('reads a friend id out of an inline onclick, from a nested child', () => {
  const el = target(
    `<div class="vrc-friend-card" onclick="openFriendDetail('${USER}')"><span id="target">Name</span></div>`,
  );
  assert.deepEqual(resolveEntity(el), { type: 'user', id: USER });
});

test('reads navOpenModal handlers and derives the type from the id prefix, not the modal name', () => {
  const el = target(
    `<div onclick="navOpenModal('worldSearch','${WORLD}','Name')"><img id="target"></div>`,
  );
  assert.deepEqual(resolveEntity(el), { type: 'world', id: WORLD });
});

test('reads VRCNext data attributes: uid, wid, avid, gid', () => {
  assert.deepEqual(resolveEntity(target(`<div data-uid="${USER}" id="target"></div>`)), { type: 'user', id: USER });
  assert.deepEqual(resolveEntity(target(`<div data-wid="${WORLD}" id="target"></div>`)), { type: 'world', id: WORLD });
  assert.deepEqual(resolveEntity(target(`<div data-avid="${AVATAR}" id="target"></div>`)), { type: 'avatar', id: AVATAR });
  assert.deepEqual(resolveEntity(target(`<div data-gid="${GROUP}" id="target"></div>`)), { type: 'group', id: GROUP });
});

test('an instance location resolves as an instance, not as its world', () => {
  const el = target(
    `<div class="vrcn-content-card" data-location="${LOCATION}" onclick="openMyInstanceDetail('${LOCATION}')"><b id="target"></b></div>`,
  );
  assert.deepEqual(resolveEntity(el), { type: 'instance', id: LOCATION });
});

test('the nearest ancestor wins over an outer container with a different entity', () => {
  const el = target(
    `<div data-gid="${GROUP}"><div class="vrcn-user-item" data-uid="${USER}"><i id="target"></i></div></div>`,
  );
  assert.deepEqual(resolveEntity(el), { type: 'user', id: USER });
});

test('data attributes on an element win over its onclick', () => {
  const el = target(
    `<div id="target" data-user-id="${USER}" onclick="openWorldDetail('${WORLD}')"></div>`,
  );
  assert.deepEqual(resolveEntity(el), { type: 'user', id: USER });
});

test('returns undefined when nothing up the tree carries an id', () => {
  const el = target(`<div class="nav-btn" onclick="showTab(3)"><span id="target">Settings</span></div>`);
  assert.equal(resolveEntity(el), undefined);
});

test('does not mistake a file id or an unprefixed value for an entity', () => {
  const el = target(
    `<div data-avatar-thumb="https://api.vrchat.cloud/api/1/file/file_0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8/1/256" id="target"></div>`,
  );
  assert.equal(resolveEntity(el), undefined);
});
