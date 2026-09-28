/**
 * A Discord embed as a setting.
 *
 * The user edits every part of the embed in the settings UI — title, description, colour,
 * author, thumbnail, image, footer, fields — and each text is a template
 * ({@link renderTemplate}) the plugin fills at send time with {@link renderEmbed}. The plugin
 * decides the variables; the user decides the layout.
 */

import type { SettingBase } from './settings.js';

export interface EmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline: boolean;
}

/**
 * Every text is a template. `color` renders to a colour: `#rrggbb`, a decimal, or a name from
 * {@link EMBED_COLORS}, so a template like `{resultColor}` works when the plugin supplies one.
 */
export interface EmbedTemplate {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly color: string;
  readonly authorName: string;
  readonly authorUrl: string;
  readonly authorIconUrl: string;
  readonly thumbnailUrl: string;
  readonly imageUrl: string;
  readonly footerText: string;
  readonly footerIconUrl: string;
  /** Stamp the embed with the time it is sent. */
  readonly timestamp: boolean;
  readonly fields: readonly EmbedField[];
}

export interface EmbedSetting extends SettingBase {
  readonly kind: 'embed';
  /** Anything left out is empty. */
  readonly default: Partial<EmbedTemplate>;
}

/** Named colours a `color` template may render to. */
export const EMBED_COLORS: Readonly<Record<string, number>> = {
  green: 0x3ba55d,
  orange: 0xf0a030,
  red: 0xed4245,
  blue: 0x5865f2,
  yellow: 0xfee75c,
  grey: 0x99aab5,
  gray: 0x99aab5,
  white: 0xffffff,
  black: 0x000000,
};

/** Discord's documented limits; {@link renderEmbed} cuts to them. */
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
} as const;

export const EMPTY_EMBED: EmbedTemplate = {
  title: '',
  description: '',
  url: '',
  color: '',
  authorName: '',
  authorUrl: '',
  authorIconUrl: '',
  thumbnailUrl: '',
  imageUrl: '',
  footerText: '',
  footerIconUrl: '',
  timestamp: false,
  fields: [],
};

const TEXT_KEYS = [
  'title', 'description', 'url', 'color', 'authorName', 'authorUrl', 'authorIconUrl',
  'thumbnailUrl', 'imageUrl', 'footerText', 'footerIconUrl',
] as const;

function coerceFields(value: unknown): readonly EmbedField[] {
  if (!Array.isArray(value)) return [];
  const out: EmbedField[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    out.push({
      name: typeof record['name'] === 'string' ? record['name'] : '',
      value: typeof record['value'] === 'string' ? record['value'] : '',
      inline: record['inline'] === true,
    });
  }
  return out.slice(0, EMBED_LIMITS.fields);
}

/** Fills a partial embed out to every field. Anything that is not an object becomes the empty embed. */
export function completeEmbed(value: Partial<EmbedTemplate> | undefined): EmbedTemplate {
  return coerceEmbed(value) ?? EMPTY_EMBED;
}

/** Accepts any object, keeping the strings it recognises; `undefined` for a non-object. */
export function coerceEmbed(value: unknown): EmbedTemplate | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...EMPTY_EMBED };
  for (const key of TEXT_KEYS) {
    const text = record[key];
    if (typeof text === 'string') out[key] = text;
  }
  out['timestamp'] = record['timestamp'] === true;
  out['fields'] = coerceFields(record['fields']);
  return out as unknown as EmbedTemplate;
}
