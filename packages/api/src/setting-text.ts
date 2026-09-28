/**
 * Checking a template against the variables its setting declares.
 *
 * A placeholder that does not parse, or names something the plugin never provides, renders as
 * nothing at all — and an empty line in a Discord message an hour later is a bad way to find out
 * about a typo. Both are decidable while the user types, so they are decided there.
 */

import { TemplateError, templatePlaceholders, validateTemplate } from './template.js';
import type { SettingVariables } from './settings.js';

/** What is wrong with a piece of template text, in one sentence. `undefined` when nothing is. */
export type TextProblem = string;

/** `a`, `a and b`, `a, b and c`. */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/**
 * Why this text would not render, if it would not.
 *
 * Syntax first, because an unclosed `{{` makes every name after it meaningless. With no declared
 * variables only syntax is checked: a setting that names none is not claiming the list is
 * complete, and marking every placeholder unknown would be noise.
 */
export function textProblem(text: string, variables: SettingVariables | undefined): TextProblem | undefined {
  const broken = validateTemplate(text);
  if (broken !== undefined) return broken.message;
  if (variables === undefined) return undefined;

  let used: readonly string[];
  try {
    used = templatePlaceholders(text);
  } catch (error) {
    // Unreachable in practice: validateTemplate parses the same text. Reported rather than
    // thrown, because a control that throws while typing loses what was typed.
    return error instanceof TemplateError ? error.message : String(error);
  }
  const unknown = used.filter((name) => !Object.hasOwn(variables, name));
  if (unknown.length === 0) return undefined;
  return unknown.length === 1
    ? `There is no variable called ${unknown[0] ?? ''}.`
    : `There are no variables called ${listOf(unknown)}.`;
}
