/**
 * The clipboard, behind the `clipboard` permission.
 *
 * A plugin cannot reach `navigator.clipboard` through the source policy's `window.`/`globalThis.`
 * rules alone, and it should not: reading the clipboard silently is the kind of thing a user
 * wants to have agreed to.
 */

export interface ClipboardApi {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}
