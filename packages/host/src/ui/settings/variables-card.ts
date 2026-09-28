/**
 * The variables a setting declares, as chips you can read and copy.
 *
 * A plugin's README is the wrong place to learn that `rejoinAgo` exists, and retyping `{`
 * `rejoinAgo` `}` by hand is how `{rejoinAg}` gets into a template. So every declared variable
 * is a chip: the name as it is written, its description on hover, and a click puts `{name}` on
 * the clipboard ready to paste.
 */

import type { SettingVariables } from '@vrcnext/plugin-api';

import { element } from '../dom.js';
import type * as widgets from '../widgets.js';

const STYLE_ID = 'vrcnext-plugins-variables-style';

const CSS = `
.vrcnx-vars { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.vrcnx-var {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: calc(11px + var(--fs-off, 0px));
  padding: 2px 7px; border-radius: 999px; cursor: pointer;
  color: var(--tx1); background: var(--bg-input); border: 1px solid transparent;
}
.vrcnx-var:hover { border-color: var(--tx3); color: var(--tx0); }
.vrcnx-var.copied { color: var(--ok); border-color: var(--ok); }
/* The field itself says what is wrong; the message under it says why. */
.vrcnx-text-invalid { border-color: var(--err) !important; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = element('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** How long a chip stays green after a copy. */
const COPIED_MS = 1200;

/**
 * One chip per variable, in the order the plugin declared them.
 *
 * That order is the plugin author's, not alphabetical: they grouped `pcRank` next to
 * `questRank` on purpose, and sorting would undo it.
 */
export function variablesCard(variables: SettingVariables): HTMLElement {
  ensureStyles();
  const root = element('div', 'vrcnx-vars');
  for (const [name, description] of Object.entries(variables)) {
    const chip = element('button', 'vrcnx-var', `{${name}}`);
    chip.type = 'button';
    chip.title = description;
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      void copy(chip, `{${name}}`);
    });
    root.appendChild(chip);
  }
  return root;
}

async function copy(chip: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // A denied clipboard is not worth an error line over a name the user can still read and type.
    return;
  }
  chip.classList.add('copied');
  setTimeout(() => { chip.classList.remove('copied'); }, COPIED_MS);
}

/** Put the field in the state its text deserves: red and explained, or neither. */
export function markText(field: HTMLElement, error: ReturnType<typeof widgets.errorLine>, problem: string | undefined): void {
  field.classList.toggle('vrcnx-text-invalid', problem !== undefined);
  error.show(problem);
}
