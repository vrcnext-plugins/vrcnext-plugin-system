/**
 * The typed event map against VRCNext's own source.
 *
 * `VrcnextEventMap` was written by reading the C#; `VrcnextEvent` and `VrcnextEventFields` are
 * generated from it (scripts/gen-vrcnext-protocol.mjs). These assignments fail to *compile* —
 * so the gate fails at `tsc` — if the map names an event VRCNext never sends, or a payload field
 * none of its senders write. Regenerating against a newer VRCNext is then enough to find what
 * moved.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { VrcnextEventMap } from './events.js';
import type { VrcnextEvent, VrcnextEventFields } from './vrcnext-protocol.generated.js';

/** Event names in the map that VRCNext does not send. */
type UnknownEvents = Exclude<keyof VrcnextEventMap, VrcnextEvent>;

/** For each mapped event whose payload is fully known, the fields VRCNext does not write. */
type UnknownFields = {
  [K in keyof VrcnextEventMap]: K extends keyof VrcnextEventFields
    ? Exclude<keyof VrcnextEventMap[K], VrcnextEventFields[K]>
    : never;
}[keyof VrcnextEventMap];

test('every event and payload field the API types exists in VRCNext', () => {
  const unknownEvents: [UnknownEvents] extends [never] ? true : UnknownEvents = true;
  const unknownFields: [UnknownFields] extends [never] ? true : UnknownFields = true;
  assert.equal(unknownEvents, true);
  assert.equal(unknownFields, true);
});
