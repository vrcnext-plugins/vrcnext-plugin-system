/**
 * {@link UiKit} over {@link widgets}.
 *
 * A thin, declarative face on the same builders the host's own panels use — so a plugin panel and
 * a host panel are the same markup, and neither can drift from VRCNext.
 *
 * Stateless, so one instance is shared by every plugin.
 */

import type {
  UiBadgeTone,
  UiButtonOptions,
  UiCardOptions,
  UiChild,
  UiDropdownOptions,
  UiGridOptions,
  UiKit,
  UiRowOptions,
  UiStatOptions,
  UiStatusCardOptions,
  UiTextFieldOptions,
  UiToggleRowOptions,
} from '@vrcnext/plugin-api';

import { element } from './dom.js';
import * as widgets from './widgets.js';

export class HostUiKit implements UiKit {
  layout(...children: readonly UiChild[]): HTMLElement {
    return widgets.panelLayout(children);
  }

  grid(children: readonly UiChild[], options?: UiGridOptions): HTMLElement {
    return widgets.grid(children, options?.min);
  }

  pair(first: UiChild, second: UiChild): HTMLElement {
    return widgets.pair(first, second);
  }

  card(options: UiCardOptions): HTMLElement {
    const node = widgets.card(options.title, options.icon, options.children ?? []);
    if (options.span !== undefined && options.span > 1) {
      node.style.gridColumn = `span ${String(options.span)}`;
    }
    return node;
  }

  statusCard(options: UiStatusCardOptions): HTMLElement {
    return widgets.statusCard({
      online: options.online,
      label: options.label,
      // `statusCard` types its action as HTMLElement; anything else has no place in that strip.
      ...(options.action instanceof HTMLElement ? { action: options.action } : {}),
    });
  }

  section(label: string, children: readonly UiChild[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(widgets.sectionLabel(label));
    widgets.appendChildren(fragment, children);
    return fragment;
  }

  row(options: UiRowOptions): HTMLElement {
    const control = typeof options.value === 'string' ? widgets.value(options.value) : options.value;
    return widgets.row(
      options.label,
      control === false || control === null ? undefined : control,
      options.detail,
    );
  }

  toggleRow(options: UiToggleRowOptions): HTMLElement {
    return widgets.row(
      options.label,
      widgets.toggle(options.value, options.onChange),
      options.detail,
    );
  }

  buttonRow(...children: readonly UiChild[]): HTMLElement {
    const root = widgets.controlRow();
    widgets.appendChildren(root, children);
    return root;
  }

  button(options: UiButtonOptions): HTMLButtonElement {
    return widgets.button(options);
  }

  textField(options: UiTextFieldOptions): HTMLInputElement {
    return widgets.textField(options);
  }

  dropdown(options: UiDropdownOptions): HTMLSelectElement {
    return widgets.dropdown(options);
  }

  badge(tone: UiBadgeTone, text: string): HTMLElement {
    return widgets.badge(tone, text);
  }

  stat(options: UiStatOptions): HTMLElement {
    return widgets.stat(options.label, options.value, options.tone);
  }

  description(text: string): HTMLElement {
    return widgets.description(text);
  }

  sectionLabel(text: string): HTMLElement {
    return widgets.sectionLabel(text);
  }

  valueText(text: string): HTMLElement {
    return widgets.value(text);
  }

  emptyState(text: string): HTMLElement {
    return widgets.emptyState(text);
  }

  setChildren(parent: Node, children: readonly UiChild[]): void {
    widgets.setChildren(parent, children);
  }

  /** Escape hatch for a plain container, so callers never reach for `createElement`. */
  box(...children: readonly UiChild[]): HTMLElement {
    const root = element('div');
    widgets.appendChildren(root, children);
    return root;
  }
}
