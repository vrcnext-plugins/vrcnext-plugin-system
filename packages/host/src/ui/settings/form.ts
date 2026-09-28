/**
 * Renders a settings schema as rows of controls.
 *
 * One function per kind, all fed the same {@link Binding}, so the same code draws a top-level
 * setting, a field inside an `object` and a field inside a `list` item. Every row carries the
 * label and description from the spec, a `fieldset` the `disabled` predicate can switch, and an
 * error line for a refused write.
 */

import {
  TOGGLE_KEY,
  defaultOf,
  settingFlag,
  textProblem,
  type CustomSetting,
  type CustomSettingHost,
  type ListSetting,
  type MultiSelectSetting,
  type NumberSetting,
  type ObjectSetting,
  type ObjectToggle,
  type SelectSetting,
  type SettingSpec,
  type SettingsSchema,
  type StringSetting,
  type VrchatApi,
} from '@vrcnext/plugin-api';

import { element } from '../dom.js';
import * as widgets from '../widgets.js';
import { markText, variablesCard } from './variables-card.js';
import { fieldBinding, itemBinding, type Binding, type Values } from './binding.js';
import { embedControl } from './embed-editor.js';
import { entityControl } from './entity-picker.js';

export interface FormContext {
  readonly vrchat: VrchatApi;
  /** The top-level values, for `hidden` and `disabled` predicates. */
  readonly values: () => Values;
  /** Where a failed write is reported besides the row's own error line. */
  readonly onError: (message: string, error?: unknown) => void;
  /** Collects unsubscribes; the form is torn down when the card is. */
  readonly track: (dispose: () => void) => void;
}

/** A control plus the hooks the row needs: a way to show errors and to follow outside writes. */
export interface Control {
  readonly element: HTMLElement;
  /** Renders the control full-width under the label. */
  readonly stacked?: boolean;
}

/** Writes through the binding, reporting a refusal on the row. */
export function commit(binding: Binding, next: unknown, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): void {
  binding.set(next).then(
    () => { error.show(undefined); },
    (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      error.show(message);
      ctx.onError(message, reason);
    },
  );
}

function numberControl(spec: NumberSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const current = Number(binding.get());
  const markers = spec.markers ?? [];
  if (spec.slider === true || markers.length > 0) {
    const min = spec.min ?? (markers.length > 0 ? Math.min(...markers) : 0);
    const max = spec.max ?? (markers.length > 0 ? Math.max(...markers) : 100);
    const node = widgets.slider({
      value: current,
      min,
      max,
      step: spec.step ?? 1,
      markers,
      ...(markers.length > 0 && spec.stickToMarkers !== false ? { snapToMarkers: true } : {}),
      ...(spec.unit === undefined ? {} : { unit: spec.unit }),
      onChange: (next) => { commit(binding, next, error, ctx); },
    });
    ctx.track(binding.onChange((value) => {
      if (typeof value === 'number' && document.activeElement !== node.querySelector('input')) node.setValue(value);
    }));
    return { element: node };
  }
  const input = widgets.textField({
    value: String(current),
    onCommit: (next) => {
      const n = Number(next);
      if (Number.isNaN(n)) error.show('Not a number.');
      else if (spec.integer === true && !Number.isInteger(n)) error.show('Whole numbers only.');
      else commit(binding, n, error, ctx);
    },
  });
  input.inputMode = spec.integer === true ? 'numeric' : 'decimal';
  ctx.track(binding.onChange((value) => {
    if (document.activeElement !== input) input.value = String(value);
  }));
  return { element: input };
}

/**
 * Check as the user types, not on blur.
 *
 * A red border that appears only after leaving the field tells someone their typo was fine
 * until they looked away. Nothing is stored here: an invalid template is still committed, and
 * the mark says so — refusing to save half-typed text would lose the rest of it.
 */
function watchText(field: HTMLInputElement | HTMLTextAreaElement, spec: SettingSpec, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): void {
  if (spec.variables === undefined) return;
  const check = (): void => { markText(field, error, textProblem(field.value, spec.variables)); };
  field.addEventListener('input', check);
  ctx.track(() => { field.removeEventListener('input', check); });
  check();
}

function stringControl(spec: StringSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const value = String(binding.get());
  const onCommit = (next: string): void => { commit(binding, next, error, ctx); };
  const placeholder = spec.placeholder === undefined ? {} : { placeholder: spec.placeholder };
  if (spec.multiline === true) {
    const area = widgets.textArea({ value, rows: 6, ...placeholder, onCommit });
    watchText(area, spec, error, ctx);
    ctx.track(binding.onChange((next) => {
      if (document.activeElement !== area) area.value = String(next);
    }));
    return { element: area, stacked: true };
  }
  const input = widgets.textField({ value, ...placeholder, onCommit });
  watchText(input, spec, error, ctx);
  if (spec.format === 'password') input.type = 'password';
  if (spec.format === 'url') input.type = 'url';
  if (spec.maxLength !== undefined) input.maxLength = spec.maxLength;
  ctx.track(binding.onChange((next) => {
    if (document.activeElement !== input) input.value = String(next);
  }));
  return { element: input };
}

function selectControl(spec: SelectSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const select = widgets.dropdown({
    options: spec.options,
    selected: String(binding.get()),
    onChange: (next) => { commit(binding, next, error, ctx); },
  });
  ctx.track(binding.onChange((next) => {
    select.value = String(next);
    select.syncSelect();
  }));
  return { element: select };
}

function multiSelectControl(spec: MultiSelectSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const read = (): readonly string[] => {
    const value = binding.get();
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  };
  const build = (): HTMLElement => widgets.chips({
    options: spec.options,
    selected: read(),
    multiple: true,
    onChange: (next) => {
      if (spec.min !== undefined && next.length < spec.min) {
        error.show(`Choose at least ${String(spec.min)}.`);
        return;
      }
      if (spec.max !== undefined && next.length > spec.max) {
        error.show(`Choose at most ${String(spec.max)}.`);
        return;
      }
      commit(binding, next, error, ctx);
    },
  });
  // A wrapping set of chips reads as a block, not as a value at the end of a row: stacked under
  // the label and left-aligned, the way VRCNext lays its own theme and cursor pickers out. Two
  // or three chips still fit at the end of the row.
  const stacked = spec.options.length > 3;
  const holder = element('div');
  holder.style.cssText = `display:flex;min-width:0;justify-content:${stacked ? 'flex-start' : 'flex-end'};`;
  holder.appendChild(build());
  ctx.track(binding.onChange(() => { widgets.setChildren(holder, [build()]); }));
  return { element: holder, stacked };
}

function customControl(spec: CustomSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const host: CustomSettingHost<unknown> = {
    get value(): unknown { return binding.get(); },
    setValue: (next) => binding.set(next),
    setError: (message) => { error.show(message); },
    onChange: (listener) => {
      const off = binding.onChange(listener);
      ctx.track(off);
      return off;
    },
  };
  try {
    return { element: spec.render(host), stacked: true };
  } catch (reason) {
    ctx.onError(`Custom setting "${spec.label}" failed to render.`, reason);
    return { element: widgets.emptyState('This setting could not be drawn.'), stacked: true };
  }
}

function objectControl(spec: ObjectSetting, binding: Binding, ctx: FormContext): Control {
  const body = element('div', 'vrcnx-nested');
  body.appendChild(renderForm(spec.fields, binding, ctx));
  if (spec.toggle !== undefined) return toggledObject(spec.toggle, body, binding, ctx);
  if (spec.collapsed !== true) return { element: body, stacked: true };
  const details = element('details');
  const summary = element('summary', 'set-desc', 'Show');
  summary.style.cursor = 'pointer';
  details.append(summary, body);
  return { element: details, stacked: true };
}

/**
 * An object behind a switch: the fields exist either way, but are only shown while it is on.
 *
 * Hidden rather than removed, because the values are the user's. Turning "use a custom
 * template" off and on again should give back the template they wrote, not an empty box.
 */
function toggledObject(toggle: ObjectToggle, body: HTMLElement, binding: Binding, ctx: FormContext): Control {
  const state = fieldBinding(binding, TOGGLE_KEY);
  // What is stored, and the declared default when nothing is — never "anything but false", which
  // would draw a switch as on while the value no reader treats as on.
  const on = (): boolean => {
    const stored = state.get();
    return typeof stored === 'boolean' ? stored : toggle.default;
  };
  const row = widgets.row(
    toggle.label,
    widgets.toggle(on(), (next) => { void state.set(next); }),
    toggle.description,
  );
  const sync = (): void => { body.style.display = on() ? '' : 'none'; };
  sync();
  ctx.track(state.onChange(sync));
  const wrapper = element('div');
  wrapper.append(row, body);
  return { element: wrapper, stacked: true };
}

/** A schema's rows, in a container that re-evaluates `hidden`/`disabled` after every change. */
export function renderForm(schema: SettingsSchema, binding: Binding, ctx: FormContext): HTMLElement {
  const root = element('div', 'vrcnx-form');
  const rows: { readonly spec: SettingSpec; readonly row: HTMLElement; readonly fieldset: HTMLFieldSetElement }[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    const built = renderSetting(key, spec, fieldBinding(binding, key), ctx);
    rows.push({ spec, ...built });
    root.appendChild(built.row);
  }
  const apply = (): void => {
    const values = ctx.values();
    for (const { spec, row, fieldset } of rows) {
      row.style.display = settingFlag(spec.hidden, values) ? 'none' : '';
      fieldset.disabled = settingFlag(spec.disabled, values);
    }
  };
  apply();
  ctx.track(binding.onChange(apply));
  return root;
}

/** Builds the control for `spec` over `binding`; kinds that nest call back into {@link renderForm}. */
function buildControl(spec: SettingSpec, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  switch (spec.kind) {
    case 'boolean': {
      const node = widgets.toggle(binding.get() === true, (next) => { commit(binding, next, error, ctx); });
      ctx.track(binding.onChange((value) => {
        const input = node.querySelector('input');
        if (input !== null) input.checked = value === true;
      }));
      return { element: node };
    }
    case 'number':
      return numberControl(spec, binding, error, ctx);
    case 'string':
      return stringControl(spec, binding, error, ctx);
    case 'color':
    case 'time': {
      const input = widgets.typedField(spec.kind, {
        value: String(binding.get()),
        onChange: (next) => { commit(binding, next, error, ctx); },
      });
      ctx.track(binding.onChange((value) => { input.value = String(value); }));
      return { element: input };
    }
    case 'select':
      return selectControl(spec, binding, error, ctx);
    case 'multiselect':
      return multiSelectControl(spec, binding, error, ctx);
    case 'user':
    case 'world':
    case 'avatar':
    case 'group':
    case 'instance':
      return entityControl(spec, binding, error, ctx);
    case 'embed':
      return embedControl(spec, binding, error, ctx);
    case 'object':
      return objectControl(spec, binding, ctx);
    case 'list':
      return listControl(spec, binding, error, ctx);
    case 'custom':
      return customControl(spec, binding, error, ctx);
  }
}

/** One labelled row. `fieldset` is what the `disabled` predicate switches. */
export function renderSetting(
  key: string,
  spec: SettingSpec,
  binding: Binding,
  ctx: FormContext,
): { readonly row: HTMLElement; readonly fieldset: HTMLFieldSetElement } {
  const error = widgets.errorLine();
  const control = buildControl(spec, binding, error, ctx);
  // The embed editor draws its own card inside the editor, beside the texts it applies to.
  const variables = spec.variables !== undefined && spec.kind !== 'embed'
    ? variablesCard(spec.variables)
    : undefined;
  const fieldset = element('fieldset');
  // `min-width: min-content` rather than 0: a fieldset is not subject to the automatic minimum
  // size flex gives every other item, so with 0 the row happily squeezes a fixed-width control
  // — a switch is 36px wide and was being cut to 21 by a long label beside it.
  fieldset.style.cssText = 'border:0;padding:0;margin:0;min-width:min-content;max-width:100%;display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
  if (control.stacked === true) {
    fieldset.style.alignItems = 'stretch';
    fieldset.style.minWidth = '0';
  }
  fieldset.append(control.element, error);
  if (variables !== undefined) fieldset.appendChild(variables);
  const row = widgets.row(spec.label, fieldset, spec.description, { stacked: control.stacked === true });
  row.classList.add(control.stacked === true ? 'vrcnx-row-stacked' : 'vrcnx-row-inline');
  row.dataset['setting'] = key;
  return { row, fieldset };
}

// ---------------------------------------------------------------------------------------------
// Lists

function listTitle(spec: ListSetting, item: unknown, index: number): string {
  const record = typeof item === 'object' && item !== null ? (item as Values) : {};
  const named = spec.titleKey === undefined ? undefined : record[spec.titleKey];
  return typeof named === 'string' && named.trim() !== '' ? named : `Item ${String(index + 1)}`;
}

function iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = widgets.button({ label: '', icon, round: true, onClick });
  node.title = title;
  node.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
  return node;
}

function listControl(spec: ListSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const root = element('div');
  root.style.minWidth = '0';
  const read = (): readonly unknown[] => {
    const value = binding.get();
    return Array.isArray(value) ? value : [];
  };
  const write = (next: readonly unknown[]): void => { commit(binding, next, error, ctx); };
  const open = new Set<number>();
  let drawn: readonly unknown[] = [];

  const itemCard = (item: unknown, index: number, count: number): HTMLElement => {
    const details = element('details', 'vrcnx-list-item');
    details.open = open.has(index);
    details.addEventListener('toggle', () => { if (details.open) open.add(index); else open.delete(index); });
    const head = element('summary', 'vrcnx-list-head');
    head.style.cursor = 'pointer';
    head.appendChild(element('span', 'vrcnx-list-title', listTitle(spec, item, index)));
    head.append(
      iconButton('arrow_upward', 'Move up', () => { if (index > 0) write(swap(read(), index, index - 1)); }),
      iconButton('arrow_downward', 'Move down', () => { if (index < count - 1) write(swap(read(), index, index + 1)); }),
      iconButton('content_copy', 'Duplicate', () => { write(read().toSpliced(index + 1, 0, structuredClone(item))); }),
      iconButton('delete', 'Remove', () => { write(read().toSpliced(index, 1)); }),
    );
    details.appendChild(head);
    details.appendChild(renderForm(spec.item, itemBinding(binding, index), ctx));
    return details;
  };

  const draw = (): void => {
    const items = read();
    drawn = items;
    const children: (HTMLElement | false)[] = items.map((item, index) => itemCard(item, index, items.length));
    const canAdd = spec.max === undefined || items.length < spec.max;
    children.push(canAdd && widgets.controlRow(widgets.button({
      label: spec.addLabel ?? 'Add',
      icon: 'add',
      onClick: () => {
        open.add(items.length);
        write([...items, defaultItem(spec.item)]);
      },
    })));
    if (items.length === 0) children.unshift(widgets.emptyState('Nothing here yet.'));
    widgets.setChildren(root, children);
    // Enforce the fold state after mounting: a <details> set before insertion does not reliably
    // keep it, and an item springing open on every redraw is the whole card jumping.
    for (const [index, card] of [...root.querySelectorAll<HTMLDetailsElement>(':scope > .vrcnx-list-item')].entries()) {
      card.open = open.has(index);
    }
  };
  draw();
  // A field edit inside an item writes the whole list; only a structural change redraws.
  ctx.track(binding.onChange(() => {
    const items = read();
    const sameShape = items.length === drawn.length && items.every((item, i) => item === drawn[i] || sameTitle(spec, item, drawn[i], i));
    if (!sameShape) draw();
    else drawn = items;
  }));
  return { element: root, stacked: true };
}

function sameTitle(spec: ListSetting, a: unknown, b: unknown, index: number): boolean {
  return listTitle(spec, a, index) === listTitle(spec, b, index);
}

function swap(items: readonly unknown[], a: number, b: number): readonly unknown[] {
  const copy = [...items];
  const first = copy[a];
  copy[a] = copy[b];
  copy[b] = first;
  return copy;
}

function defaultItem(item: SettingsSchema): Values {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(item)) out[key] = defaultOf(spec);
  return out;
}
