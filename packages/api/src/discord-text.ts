/**
 * Writing text Discord renders the way you meant.
 *
 * Discord's message markdown is applied to anything a plugin interpolates, so a world called
 * `**Club**` styles the line it appears in and a name containing a backtick breaks out of a code
 * span. These two helpers are what a report needs to quote a name and to state a time; they live
 * here so no plugin carries its own copy.
 */

import { type TimeInput } from './time.js';

/** How Discord renders a timestamp: `R` is "3 hours ago", `f` a date and time, `t` a clock. */
export type DiscordTimeStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

/**
 * A name as a code span, so nothing inside it can style the line.
 *
 * Discord has no escape character inside a code span, so a name that itself contains backticks
 * is fenced with a longer run of them and padded with spaces — the one construction Discord
 * honours.
 */
export function discordCode(name: string): string {
  if (!name.includes('`')) return `\`${name}\``;
  const longest = Math.max(...[...name.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${name} ${fence}`;
}

/**
 * `<t:1790517600:R>` — a time Discord renders in the reader's own timezone and language.
 *
 * Worth the markup rather than a formatted clock time: the default `R` style keeps saying "3
 * hours ago" correctly however long the message sits in the channel, which a baked-in time
 * cannot. `''` when the instant cannot be read, which drops the line rather than printing `NaN`.
 */
export function discordTimestamp(at: TimeInput, style: DiscordTimeStyle = 'R'): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  return `<t:${String(Math.floor(ms / 1000))}:${style}>`;
}
