import assert from 'node:assert/strict';
import { test } from 'vitest';

import { discordCode, discordTimestamp } from './discord-text.js';

test('discordCode fences a plain name', () => {
  assert.equal(discordCode('Club Neon'), '`Club Neon`');
  assert.equal(discordCode(''), '``');
});

test('discordCode outgrows backticks inside the name', () => {
  assert.equal(discordCode('a`b'), '`` a`b ``');
  assert.equal(discordCode('a``b'), '``` a``b ```');
  assert.equal(discordCode('```'), '```` ``` ````');
});

test('discordTimestamp is seconds, with a style', () => {
  assert.equal(discordTimestamp('2026-09-27T12:00:00Z'), '<t:1790510400:R>');
  assert.equal(discordTimestamp(1790510400_000, 'f'), '<t:1790510400:f>');
  assert.equal(discordTimestamp(new Date('2026-09-27T12:00:00Z')), '<t:1790510400:R>');
  assert.equal(discordTimestamp('nonsense'), '');
});
