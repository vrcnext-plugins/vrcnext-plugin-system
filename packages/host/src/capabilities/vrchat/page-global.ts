/**
 * Reads one of VRCNext's own page variables.
 *
 * Its frontend is classic scripts, and a top-level `let`/`const` there lives in the global
 * declarative record rather than on `window`, so a property lookup finds nothing. An indirect
 * `eval` runs in global scope and does see it. Nothing is executed that does not come from the
 * page itself: the name is a fixed identifier chosen by the host, never anything a plugin
 * supplies.
 */
export function pageGlobal(name: string): unknown {
  const onWindow: unknown = (globalThis as Record<string, unknown>)[name];
  if (onWindow !== undefined) return onWindow;
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return undefined;
  try {
    // Indirect, so it runs in global scope rather than this function's.
    const indirect = eval;
    return indirect(`typeof ${name} === 'undefined' ? undefined : ${name}`);
  } catch {
    return undefined;
  }
}
