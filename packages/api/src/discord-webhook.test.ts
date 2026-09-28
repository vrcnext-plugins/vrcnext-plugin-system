import assert from 'node:assert/strict';
import { test } from 'vitest';

import { webhookPayload, type DiscordWebhookPayload } from './discord-embed.js';
import type { HttpApi } from './http.js';
import type { Logger } from './logger.js';
import { isDiscordWebhookUrl, postWebhook, webhookFailure } from './discord-webhook.js';

const URL_OK = 'https://discord.com/api/webhooks/123456789/abcDEF-ghi_jkl';
const PAYLOAD: DiscordWebhookPayload = webhookPayload({ title: 'Hi', description: 'there' });

interface Taken {
  readonly lines: string[];
  readonly urls: string[];
  readonly bodies: string[];
}

function fake(answer: Partial<Response> | Error): { taken: Taken; http: HttpApi; logger: Logger } {
  const taken: Taken = { lines: [], urls: [], bodies: [] };
  const logger = {
    debug: (m: string) => { taken.lines.push(`debug ${m}`); },
    info: (m: string) => { taken.lines.push(`info ${m}`); },
    warn: (m: string) => { taken.lines.push(`warn ${m}`); },
    error: (m: string) => { taken.lines.push(`error ${m}`); },
    scoped: () => logger,
  } as unknown as Logger;
  const http = {
    fetch: (url: string | globalThis.URL, init?: RequestInit): Promise<Response> => {
      taken.urls.push(String(url));
      const body = init?.body;
      taken.bodies.push(typeof body === 'string' ? body : '');
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as Response);
    },
  };
  return { taken, http, logger };
}

test('only a discord.com webhook URL is posted to', () => {
  assert.equal(isDiscordWebhookUrl(URL_OK), true);
  assert.equal(isDiscordWebhookUrl(`  ${URL_OK}  `), true, 'a pasted URL carries whitespace');
  assert.equal(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/1/tok'), true, 'the old domain still works');
  assert.equal(isDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/1/tok'), false, 'another host is another manifest entry');
  assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/tok'), false, 'never plaintext');
  assert.equal(isDiscordWebhookUrl('https://evil.test/api/webhooks/1/tok'), false);
  assert.equal(isDiscordWebhookUrl(''), false);
});

test('a bad URL is refused without a request going out', async () => {
  const { taken, http, logger } = fake({ ok: true, status: 204 });
  const result = await postWebhook({ http, logger, url: 'https://evil.test/hook', payload: PAYLOAD });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /not a discord\.com webhook URL/);
  assert.deepEqual(taken.urls, [], 'nothing was sent anywhere');
});

test('the whole payload is dumped at debug before it is sent, and the URL never is', async () => {
  const { taken, http, logger } = fake({ ok: true, status: 204 });
  const result = await postWebhook({ http, logger, url: URL_OK, payload: PAYLOAD, label: 'Club' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 204);

  const dump = taken.lines.find((l) => l.includes('posting'));
  assert.ok(dump !== undefined, 'a payload dump is not optional');
  assert.match(dump, /^debug Club: posting \d+ bytes to Discord: /);
  // The whole thing, verbatim — not a summary, not truncated.
  assert.ok(dump.includes(JSON.stringify(PAYLOAD)));
  assert.equal(taken.bodies[0], JSON.stringify(PAYLOAD), 'what was logged is what was sent');

  const all = taken.lines.join('\n');
  assert.ok(!all.includes('abcDEF-ghi_jkl'), 'the webhook token is a credential and is never logged');
});

test('a refused post explains itself and does not throw', async () => {
  const { taken, http, logger } = fake({ ok: false, status: 404 });
  const result = await postWebhook({ http, logger, url: URL_OK, payload: PAYLOAD, label: 'Club' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.match(String(result.error), /^Club: That webhook no longer exists/);
  assert.ok(!taken.lines.join('\n').includes('abcDEF'), 'still no token in the log');
});

test('a request that never got an answer is a failure, not a rejection', async () => {
  const { http, logger } = fake(new Error('offline'));
  const result = await postWebhook({ http, logger, url: URL_OK, payload: PAYLOAD });
  assert.equal(result.ok, false);
  assert.equal(result.status, undefined);
  assert.match(String(result.error), /the request to Discord failed: Error: offline/);
  assert.ok(!String(result.error).includes('abcDEF'), 'a failure message never carries the URL');
});

test('an unlabelled sender just says what happened', async () => {
  const { taken, http, logger } = fake({ ok: true, status: 204 });
  await postWebhook({ http, logger, url: URL_OK, payload: PAYLOAD });
  assert.match(String(taken.lines[0]), /^debug posting \d+ bytes/);
});

test('each status says what to do about it', () => {
  assert.match(webhookFailure(401), /regenerated or the URL is mis-copied/);
  assert.match(webhookFailure(403), /Server Settings → Integrations → Webhooks/);
  assert.match(webhookFailure(404), /no longer exists/);
  assert.match(webhookFailure(429), /rate-limiting/);
  assert.match(webhookFailure(400), /refused the embed/);
  assert.match(webhookFailure(503), /their side, not the embed/);
  assert.equal(webhookFailure(418), 'Discord answered 418.');
});
