import assert from 'node:assert/strict';
import { test } from 'vitest';

import { fillTemplate, templatePlaceholders } from './template.js';

test('substitutes known placeholders and leaves unknown ones visible', () => {
  assert.equal(fillTemplate('Hi {name}, {nope}', { name: 'Tupper' }), 'Hi Tupper, {nope}');
});

test('drops a line whose placeholders all came out empty, keeps literal lines', () => {
  const template = 'Player {name}\nIn Group: {inGroup}\nRejoin: {rejoin}\n---';
  assert.equal(
    fillTemplate(template, { name: 'T', inGroup: undefined, rejoin: 'No' }),
    'Player T\nRejoin: No\n---',
  );
  assert.equal(
    fillTemplate(template, { name: 'T', inGroup: '', rejoin: 'No' }, { dropEmptyLines: false }),
    'Player T\nIn Group: \nRejoin: No\n---',
  );
});

test('a line with one filled and one empty placeholder stays', () => {
  assert.equal(fillTemplate('{a} / {b}', { a: 'x', b: '' }), 'x / ');
});

test('templatePlaceholders lists names once, in order', () => {
  assert.deepEqual(templatePlaceholders('{b} {a} {b} {c.d}'), ['b', 'a', 'c.d']);
});
