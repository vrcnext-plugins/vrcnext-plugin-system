import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parseEmbedColor, renderEmbed, webhookPayload } from './discord-embed.js';
import { EMPTY_EMBED } from './settings-embed.js';

const VALUES = { name: 'Tupper', ok: true, resultColor: 'green', pic: 'https://x.test/a.png', empty: '' };

test('parseEmbedColor accepts names, hex and decimals', () => {
  assert.equal(parseEmbedColor('green'), 0x3ba55d);
  assert.equal(parseEmbedColor('#ED4245'), 0xed4245);
  assert.equal(parseEmbedColor('0x5865f2'), 0x5865f2);
  assert.equal(parseEmbedColor('255'), 255);
  assert.equal(parseEmbedColor(''), undefined);
  assert.equal(parseEmbedColor('purpleish'), undefined);
});

test('renderEmbed fills every text, drops what is empty and validates URLs', () => {
  const embed = renderEmbed(
    {
      ...EMPTY_EMBED,
      title: '{name} {{ "passed" if ok else "failed" }}',
      color: '{resultColor}',
      authorName: 'Club',
      authorUrl: 'not a url',
      thumbnailUrl: '{pic}',
      footerText: '{empty}',
      timestamp: true,
      fields: [
        { name: 'Verified', value: '{{ ok | yesno("yes", "no") }}', inline: true },
        { name: 'Nothing', value: '{empty}', inline: false },
      ],
    },
    VALUES,
    { at: new Date('2026-09-27T12:00:00Z') },
  );
  assert.deepEqual(embed, {
    title: 'Tupper passed',
    color: 0x3ba55d,
    timestamp: '2026-09-27T12:00:00.000Z',
    author: { name: 'Club' },
    thumbnail: { url: 'https://x.test/a.png' },
    fields: [{ name: 'Verified', value: 'yes', inline: true }],
  });
});

test('an empty result is undefined and a broken part is reported, not fatal', () => {
  assert.equal(renderEmbed(EMPTY_EMBED, VALUES), undefined);
  const errors: string[] = [];
  const embed = renderEmbed({ ...EMPTY_EMBED, title: '{{ name', description: 'ok' }, VALUES, { onError: (e) => { errors.push(e.message); } });
  assert.deepEqual(embed, { description: 'ok' });
  assert.equal(errors.length, 1);
});

test('texts are cut to Discord limits', () => {
  const embed = renderEmbed({ ...EMPTY_EMBED, title: 'x'.repeat(300) }, {});
  assert.equal(embed?.title?.length, 256);
});

test('webhookPayload never allows mentions', () => {
  assert.deepEqual(webhookPayload({ title: 'T' }, { username: 'Bot' }), {
    username: 'Bot',
    embeds: [{ title: 'T' }],
    allowed_mentions: { parse: [] },
  });
});
