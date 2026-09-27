/**
 * `{placeholder}` templates for user-editable message formats.
 *
 * A plugin that lets the user shape a notification wants three things: substitution, a way to
 * leave a line out when its fact is not there, and no surprises from stray braces. This gives
 * exactly those. Unknown placeholders are left as written so a typo is visible in the output
 * rather than silently blank.
 */

export interface FillOptions {
  /**
   * Drop a line when every placeholder on it resolved to nothing and it had at least one.
   * That is how "In Group: {inGroup}" disappears when no group filter is set. Default `true`.
   */
  readonly dropEmptyLines?: boolean;
}

const PLACEHOLDER = /\{([A-Za-z_][\w.-]*)\}/g;

/** Substitutes `{name}` with `values.name`. `undefined` and `''` both count as nothing. */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | undefined>>,
  options: FillOptions = {},
): string {
  const dropEmpty = options.dropEmptyLines ?? true;
  const out: string[] = [];
  for (const line of template.split('\n')) {
    let placeholders = 0;
    let filled = 0;
    const text = line.replace(PLACEHOLDER, (whole, name: string) => {
      if (!Object.hasOwn(values, name)) return whole;
      placeholders += 1;
      const value = values[name] ?? '';
      if (value !== '') filled += 1;
      return value;
    });
    if (dropEmpty && placeholders > 0 && filled === 0) continue;
    out.push(text);
  }
  return out.join('\n');
}

/** The placeholder names a template uses, in order of first appearance. */
export function templatePlaceholders(template: string): readonly string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}
