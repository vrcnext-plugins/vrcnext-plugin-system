/**
 * Posting to a Discord webhook.
 *
 * {@link renderEmbed} and {@link discordWebhookPayload} build what to send; this sends it. Every plugin
 * that posts to Discord wants the same four things around that one request — a URL it can trust,
 * the payload written to the log before it leaves, a status turned into something the user can
 * act on, and a promise that never rejects — so they live here rather than in each plugin.
 *
 * The webhook URL is a bearer credential: whoever has it can post to that channel. It is never
 * logged, not even at debug, and never included in a failure message.
 */

import type { DiscordWebhookPayload } from './discord-embed.js';
import type { HttpApi } from './http.js';
import type { Logger } from './logger.js';

/**
 * A `discord.com` webhook URL.
 *
 * Deliberately narrow. `ptb.` and `canary.` are real Discord hosts but a different entry in a
 * manifest's `hosts`, so a plugin that wants them says so itself rather than inheriting a
 * permission from this helper. `discordapp.com` is Discord's old domain and still resolves;
 * it is accepted because webhook URLs copied years ago still carry it.
 */
const WEBHOOK_URL = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** Whether `url` is a Discord webhook URL this helper will post to. */
export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_URL.test(url.trim());
}

/**
 * What a refused webhook means, in terms of something to do about it.
 *
 * A bare status code is a number to go and look up. Discord's failures here have exactly a few
 * causes, and each one has a different fix — a deleted webhook and a rate limit look identical
 * otherwise, and only one of them is worth touching the settings over.
 */
export function webhookFailure(status: number): string {
  if (status === 401 || status === 403) {
    return `Discord rejected the webhook token (${String(status)}). It was regenerated or the URL is `
      + 'mis-copied; take a fresh one from Server Settings → Integrations → Webhooks.';
  }
  if (status === 404) {
    return 'That webhook no longer exists (404). It was deleted in Discord, or the URL is wrong.';
  }
  if (status === 429) {
    return 'Discord is rate-limiting this webhook (429); the message was dropped.';
  }
  if (status === 400) {
    return 'Discord refused the embed (400). Something in it renders to more than an embed may '
      + 'carry, or to an invalid colour or URL.';
  }
  if (status >= 500) {
    return `Discord could not take the message (${String(status)}); this is their side, not the embed.`;
  }
  return `Discord answered ${String(status)}.`;
}

export interface PostWebhookOptions {
  /** The plugin's `ctx.http`; `discord.com` must be in the manifest's `hosts`. */
  readonly http: HttpApi;
  /** Where the payload dump and any failure go. */
  readonly logger: Logger;
  readonly url: string;
  readonly payload: DiscordWebhookPayload;
  /**
   * Names the sender in every log line, for a plugin that posts to more than one webhook — a
   * preset's name, a channel's name. Omitted, the lines just say what happened.
   */
  readonly label?: string;
}

export interface PostWebhookResult {
  readonly ok: boolean;
  /** Discord's status, absent when the request never got an answer. */
  readonly status?: number;
  /** Why it failed, already phrased for the user. Absent when it succeeded. */
  readonly error?: string;
}

function prefix(label: string | undefined): string {
  return label === undefined || label === '' ? '' : `${label}: `;
}

/**
 * Posts `payload` and reports what happened. Never rejects: a caller decides how loud a failed
 * post is, and a notification channel that throws would take its siblings down with it.
 *
 * The full payload is written at debug before the request goes out — every time, not a summary
 * and not truncated. It is the only way to tell "Discord did not render what I meant" from
 * "the plugin did not send what I meant", and the two look identical from the outside: a picture
 * that does not appear, a field that is not there, and a 204 either way. Debug means it is
 * written only while the host's verbose logging is on.
 */
export async function postWebhook(options: PostWebhookOptions): Promise<PostWebhookResult> {
  const { http, logger, payload, label } = options;
  const at = prefix(label);
  const url = options.url.trim();
  if (!isDiscordWebhookUrl(url)) {
    return { ok: false, error: `${at}that is not a discord.com webhook URL.` };
  }
  const body = JSON.stringify(payload);
  logger.debug(`${at}posting ${String(body.length)} bytes to Discord: ${body}`);
  let response: Response;
  try {
    // reuse: Discord is not VRCNext — there is no local copy of a message not yet sent.
    response = await http.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    // The URL would name the channel's secret, so the message says only that the post failed.
    return { ok: false, error: `${at}the request to Discord failed: ${String(error)}` };
  }
  if (response.ok) {
    logger.debug(`${at}Discord accepted the message (${String(response.status)}).`);
    return { ok: true, status: response.status };
  }
  return { ok: false, status: response.status, error: `${at}${webhookFailure(response.status)}` };
}
