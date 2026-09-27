/**
 * A blocking dialog over VRCNext's page.
 *
 * VRCNext's own confirm dialog only knows one button and one callback, so the consent and
 * permission prompts need their own shell: a backdrop that swallows clicks, a `.vrcn-panel-card`
 * for the body so it inherits the theme, and a button row. Escape is deliberately *not* a
 * dismiss — a permission prompt must be answered, not blinked away by a stray key.
 */

import type { UiChild } from '@vrcnext/plugin-api';

import { CLASSES, element } from './dom.js';
import { appendChildren, button, controlRow } from './widgets.js';

const STYLE_ID = 'vrcnext-plugins-modal-style';

const MODAL_CSS = `
.vrcnx-backdrop {
  position: fixed; inset: 0; z-index: 100001;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .55);
}
.vrcnx-modal { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; }
.vrcnx-modal-title { font-weight: 600; color: var(--tx0); font-size: calc(14px + var(--fs-off, 0px)); }
.vrcnx-modal details { margin: 8px 0; }
.vrcnx-modal summary { cursor: pointer; color: var(--tx2); font-size: calc(12px + var(--fs-off, 0px)); }
.vrcnx-modal pre {
  margin: 4px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--bg-input);
  color: var(--tx2); font-size: calc(11px + var(--fs-off, 0px)); white-space: pre-wrap;
  word-break: break-word; max-height: 240px; overflow: auto;
}
.vrcnx-modal-buttons { margin-top: 12px; justify-content: flex-end; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = element('style');
  style.id = STYLE_ID;
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

export interface ModalButton<T> {
  readonly label: string;
  readonly icon?: string;
  readonly value: T;
}

export interface ModalOptions<T> {
  readonly title: string;
  readonly icon: string;
  readonly body: readonly UiChild[];
  readonly buttons: readonly ModalButton<T>[];
  /** Filled in with a function that closes the modal with a value, for bodies that resolve themselves. */
  readonly closer?: { close?: (value: T) => void };
}

/** Show a modal and resolve with the value of the button that was pressed. */
export function showModal<T>(options: ModalOptions<T>): Promise<T> {
  ensureStyles();
  return new Promise<T>((resolve) => {
    const backdrop = element('div', 'vrcnx-backdrop');
    const card = element('div', `${CLASSES.card} vrcnx-modal`);
    const header = element('div', CLASSES.cardHeader);
    header.append(element('span', CLASSES.icon, options.icon), element('span', 'vrcnx-modal-title', options.title));
    card.appendChild(header);
    appendChildren(card, options.body);

    const close = (value: T): void => {
      backdrop.remove();
      resolve(value);
    };
    if (options.closer !== undefined) options.closer.close = close;
    const row = controlRow();
    row.classList.add('vrcnx-modal-buttons');
    for (const choice of options.buttons) {
      row.appendChild(
        button({
          label: choice.label,
          ...(choice.icon !== undefined ? { icon: choice.icon } : {}),
          onClick: () => { close(choice.value); },
        }),
      );
    }
    card.appendChild(row);
    backdrop.appendChild(card);
    // Clicks on the backdrop must not reach VRCNext's page underneath, and must not dismiss.
    backdrop.addEventListener('click', (event) => { event.stopPropagation(); });
    document.body.appendChild(backdrop);
  });
}

/** A collapsed block of detail lines, opened by the user. */
export function detailsBlock(entries: readonly { readonly label: string; readonly value: string }[]): HTMLElement {
  const block = element('details');
  block.appendChild(element('summary', undefined, 'Details'));
  for (const entry of entries) {
    block.appendChild(element('div', 'sf-section-label', entry.label));
    block.appendChild(element('pre', undefined, entry.value));
  }
  return block;
}
