/**
 * The editor behind `embed` settings: every part of a Discord embed as its own field, plus a
 * list of name/value fields, folded under a summary so a card with several embeds stays short.
 * Each text is a template; the spec's `variables` are listed so the user knows what to write.
 */

import { completeEmbed, type EmbedField, type EmbedSetting, type EmbedTemplate } from '@vrcnext/plugin-api';

import { element } from '../dom.js';
import * as widgets from '../widgets.js';
import type { Binding } from './binding.js';
import type { Control, FormContext } from './form.js';
import { commit } from './form.js';

type TextKey = Exclude<keyof EmbedTemplate, 'timestamp' | 'fields'>;

const TEXTS: readonly { readonly key: TextKey; readonly label: string; readonly multiline?: boolean }[] = [
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'url', label: 'Title link' },
  { key: 'color', label: 'Colour' },
  { key: 'authorName', label: 'Author' },
  { key: 'authorUrl', label: 'Author link' },
  { key: 'authorIconUrl', label: 'Author icon URL' },
  { key: 'thumbnailUrl', label: 'Thumbnail URL' },
  { key: 'imageUrl', label: 'Image URL' },
  { key: 'footerText', label: 'Footer' },
  { key: 'footerIconUrl', label: 'Footer icon URL' },
];

function fieldRows(fields: readonly EmbedField[], write: (next: readonly EmbedField[]) => void): HTMLElement {
  const root = element('div', 'vrcnx-nested');
  const update = (index: number, patch: Partial<EmbedField>): void => {
    const current = fields[index];
    if (current !== undefined) write(fields.with(index, { ...current, ...patch }));
  };
  fields.forEach((field, index) => {
    const name = widgets.textField({ value: field.name, placeholder: 'Name', onCommit: (next) => { update(index, { name: next }); } });
    const value = widgets.textField({ value: field.value, placeholder: 'Value', onCommit: (next) => { update(index, { value: next }); } });
    const inline = widgets.toggle(field.inline, (next) => { update(index, { inline: next }); });
    const remove = widgets.button({ label: '', icon: 'delete', round: true, onClick: () => { write(fields.toSpliced(index, 1)); } });
    const strip = widgets.controlRow(name, value, widgets.value('inline'), inline, remove);
    strip.style.flexWrap = 'nowrap';
    root.appendChild(strip);
  });
  root.appendChild(widgets.controlRow(widgets.button({
    label: 'Add field',
    icon: 'add',
    onClick: () => { write([...fields, { name: '', value: '', inline: false }]); },
  })));
  return root;
}

export function embedControl(spec: EmbedSetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const details = element('details');
  const summary = element('summary', 'set-desc');
  summary.style.cursor = 'pointer';
  const body = element('div', 'vrcnx-nested');
  details.append(summary, body);

  const read = (): EmbedTemplate => completeEmbed(binding.get() as Partial<EmbedTemplate>);
  const write = (patch: Partial<EmbedTemplate>): void => { commit(binding, { ...read(), ...patch }, error, ctx); };
  let drawn: EmbedTemplate | undefined;

  const draw = (): void => {
    const embed = read();
    drawn = embed;
    summary.textContent = embed.title.trim() === '' ? 'Embed (untitled)' : `Embed: ${embed.title}`;
    const rows: HTMLElement[] = TEXTS.map((text) => {
      const value = embed[text.key];
      const control = text.multiline === true
        ? widgets.textArea({ value, rows: 4, onCommit: (next) => { write({ [text.key]: next }); } })
        : widgets.textField({ value, onCommit: (next) => { write({ [text.key]: next }); } });
      return widgets.row(text.label, control, undefined, { stacked: text.multiline === true });
    });
    rows.push(widgets.row('Timestamp', widgets.toggle(embed.timestamp, (next) => { write({ timestamp: next }); }), 'Stamp the embed with the time it is sent.'));
    rows.push(widgets.row('Fields', undefined, 'Name and value pairs; inline ones sit side by side.'));
    rows.push(fieldRows(embed.fields, (fields) => { write({ fields }); }));
    if (spec.variables !== undefined && spec.variables.length > 0) {
      rows.push(widgets.description(`Variables: ${spec.variables.map((v) => `{${v}}`).join(' ')}`));
    }
    widgets.setChildren(body, rows);
  };
  draw();
  // Text edits commit on blur, so redrawing on every change would not lose typing; only skip
  // when nothing but the object identity changed.
  ctx.track(binding.onChange(() => {
    const embed = read();
    if (drawn !== undefined && JSON.stringify(embed) === JSON.stringify(drawn)) return;
    draw();
  }));
  return { element: details, stacked: true };
}
