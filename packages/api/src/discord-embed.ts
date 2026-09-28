/**
 * Turns an {@link EmbedTemplate} into the JSON Discord's webhook endpoint takes.
 *
 * Every text goes through the template engine with the plugin's values; what renders empty is
 * left out, URLs that are not `http(s)` are dropped, and everything is cut to Discord's limits,
 * so a user-edited template cannot produce a payload Discord rejects.
 */

import { EMBED_COLORS, EMBED_LIMITS, type EmbedTemplate } from './settings-embed.js';
import { renderTemplate, type TemplateValues } from './template.js';

export interface DiscordEmbed {
  readonly title?: string;
  readonly description?: string;
  readonly url?: string;
  readonly color?: number;
  readonly timestamp?: string;
  readonly author?: { readonly name: string; readonly url?: string; readonly icon_url?: string };
  readonly thumbnail?: { readonly url: string };
  readonly image?: { readonly url: string };
  readonly footer?: { readonly text: string; readonly icon_url?: string };
  readonly fields?: readonly { readonly name: string; readonly value: string; readonly inline: boolean }[];
}

/** The body of a webhook POST: `username` and `content` are optional, embeds carry the report. */
export interface DiscordWebhookPayload {
  readonly username?: string;
  readonly avatar_url?: string;
  readonly content?: string;
  readonly embeds: readonly DiscordEmbed[];
  /** Nobody is pinged by a report, whatever the template says. */
  readonly allowed_mentions: { readonly parse: readonly [] };
}

export interface RenderEmbedOptions {
  /** The time for `timestamp`; defaults to now. */
  readonly at?: Date;
}

/** `#rrggbb`, `rrggbb`, `0xrrggbb`, a decimal, or a name from {@link EMBED_COLORS}. */
export function parseEmbedColor(text: string): number | undefined {
  const raw = text.trim().toLowerCase();
  if (raw === '') return undefined;
  const named = EMBED_COLORS[raw];
  if (named !== undefined) return named;
  const hex = /^(?:#|0x)?([0-9a-f]{6})$/.exec(raw);
  if (hex !== null) return Number.parseInt(hex[1] ?? '0', 16);
  if (/^\d{1,8}$/.test(raw)) {
    const number = Number(raw);
    return number <= 0xffffff ? number : undefined;
  }
  return undefined;
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function url(text: string): string | undefined {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : undefined;
}

/**
 * Renders every text of the template. Each is a small program the user wrote, so a template
 * error in one part is reported through `onError` and that part renders empty rather than
 * losing the whole embed.
 */
function renderer(values: TemplateValues, onError?: (error: Error) => void): (template: string) => string {
  return (template: string): string => {
    if (template.trim() === '') return '';
    try {
      return renderTemplate(template, values).trim();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return '';
    }
  };
}

/** Drops `undefined` members, so optional fields are absent rather than present-and-undefined. */
function compact<T extends object>(value: { readonly [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The embed with the values filled in, or `undefined` when nothing rendered — Discord refuses
 * an embed with no content.
 */
export function renderEmbed(
  template: EmbedTemplate,
  values: TemplateValues,
  options: RenderEmbedOptions & { readonly onError?: (error: Error) => void } = {},
): DiscordEmbed | undefined {
  const render = renderer(values, options.onError);
  const title = cut(render(template.title), EMBED_LIMITS.title);
  const description = cut(render(template.description), EMBED_LIMITS.description);
  const authorName = cut(render(template.authorName), EMBED_LIMITS.author);
  const footerText = cut(render(template.footerText), EMBED_LIMITS.footer);
  const fields = template.fields
    .map((field) => ({
      name: cut(render(field.name), EMBED_LIMITS.fieldName),
      value: cut(render(field.value), EMBED_LIMITS.fieldValue),
      inline: field.inline,
    }))
    .filter((field) => field.name !== '' && field.value !== '')
    .slice(0, EMBED_LIMITS.fields);
  const thumbnail = url(render(template.thumbnailUrl));
  const image = url(render(template.imageUrl));

  if (title === '' && description === '' && authorName === '' && footerText === '' && fields.length === 0 && thumbnail === undefined && image === undefined) {
    return undefined;
  }
  return compact<DiscordEmbed>({
    title: title === '' ? undefined : title,
    description: description === '' ? undefined : description,
    url: url(render(template.url)),
    color: parseEmbedColor(render(template.color)),
    timestamp: template.timestamp ? (options.at ?? new Date()).toISOString() : undefined,
    author: authorName === ''
      ? undefined
      : compact<NonNullable<DiscordEmbed['author']>>({ name: authorName, url: url(render(template.authorUrl)), icon_url: url(render(template.authorIconUrl)) }),
    thumbnail: thumbnail === undefined ? undefined : { url: thumbnail },
    image: image === undefined ? undefined : { url: image },
    footer: footerText === '' ? undefined : compact<NonNullable<DiscordEmbed['footer']>>({ text: footerText, icon_url: url(render(template.footerIconUrl)) }),
    fields: fields.length === 0 ? undefined : fields,
  });
}

/** A Discord webhook body carrying one embed. */
export function discordWebhookPayload(embed: DiscordEmbed, options: { readonly username?: string; readonly content?: string } = {}): DiscordWebhookPayload {
  return compact<DiscordWebhookPayload>({
    username: options.username,
    content: options.content,
    embeds: [embed],
    allowed_mentions: { parse: [] as const },
  });
}
