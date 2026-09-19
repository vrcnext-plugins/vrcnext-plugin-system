/**
 * Live log viewer for the Plugins tab.
 *
 * Exists because VRCNext's activity-log file is not writable from the page — this, plus the
 * download button, is how a user follows plugin activity without opening devtools.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

import { formatRecord, LEVEL_ORDER, type LogRecord, type LogSink } from '../log/log-sink.js';
import { element } from './dom.js';
import { button, controlRow, dropdown, sectionLabel } from './widgets.js';

const MAX_RENDERED_LINES = 500;
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_COLOR: Readonly<Record<LogLevel, string>> = {
  debug: 'var(--tx3)',
  info: 'var(--tx2)',
  warn: 'var(--warn, #e6a23c)',
  error: 'var(--err, #f56c6c)',
};

export class LogPanel {
  readonly #sink: LogSink;
  #minLevel: LogLevel = 'debug';
  #scope = '';
  #list: HTMLElement | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(sink: LogSink) {
    this.#sink = sink;
  }

  render(card: HTMLElement): void {
    card.appendChild(this.#buildControls());
    card.appendChild(sectionLabel('Output'));

    // `.folder-list` is VRCNext's own inset scroll container — same inset fill and radius its
    // settings lists use. Only the monospace face is added on top, which a log genuinely needs.
    const list = element('div', 'folder-list');
    list.style.cssText =
      'max-height:340px;overflow-y:auto;margin-bottom:0;' +
      'font-family:ui-monospace,monospace;font-size:calc(11px + var(--fs-off, 0px));line-height:1.55;';
    this.#list = list;
    card.appendChild(list);

    this.#redraw();
    this.#unsubscribe = this.#sink.subscribe((record) => { this.#onRecord(record); });
  }

  #buildControls(): HTMLElement {
    const level = dropdown({
      options: LEVELS.map((name) => ({ value: name, label: name.toUpperCase() })),
      selected: this.#minLevel,
      onChange: (next) => {
        this.#minLevel = LEVELS.find((candidate) => candidate === next) ?? 'debug';
        this.#redraw();
      },
    });

    // Scopes appear as plugins load, so the list is rebuilt when the user opens it rather than
    // frozen at render time.
    const scope = dropdown({
      options: [{ value: '', label: 'All plugins' }],
      selected: '',
      onChange: (next) => {
        this.#scope = next;
        this.#redraw();
      },
    });
    scope.addEventListener('mousedown', () => {
      const current = scope.value;
      scope.replaceChildren();
      for (const { value, label } of [
        { value: '', label: 'All plugins' },
        ...this.#sink.scopes().map((name) => ({ value: name, label: name })),
      ]) {
        const option = element('option', undefined, label);
        option.value = value;
        scope.appendChild(option);
      }
      scope.value = current;
    });

    return controlRow(
      level,
      scope,
      button({
        label: 'Copy',
        icon: 'content_copy',
        onClick: () => { void navigator.clipboard.writeText(this.#text()); },
      }),
      button({ label: 'Download', icon: 'download', onClick: () => { this.#download(); } }),
      button({
        label: 'Clear',
        icon: 'cleaning_services',
        onClick: () => {
          this.#sink.clear();
          this.#redraw();
        },
      }),
    );
  }

  #text(): string {
    return this.#sink.toText({
      level: this.#minLevel,
      ...(this.#scope === '' ? {} : { scope: this.#scope }),
    });
  }

  /** Writes a real file to the user's Downloads folder — the page cannot write anywhere else. */
  #download(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([this.#text()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = element('a');
    anchor.href = url;
    anchor.download = `vrcnext-plugins-${stamp}.log`;
    anchor.click();
    // Revoke on the next tick so the download has started.
    globalThis.setTimeout(() => { URL.revokeObjectURL(url); }, 0);
  }

  #matches(record: LogRecord): boolean {
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER[this.#minLevel]) return false;
    return this.#scope === '' || record.scope === this.#scope;
  }

  #onRecord(record: LogRecord): void {
    const list = this.#list;
    if (list === undefined || !this.#matches(record)) return;

    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.appendChild(LogPanel.#line(record));
    while (list.childElementCount > MAX_RENDERED_LINES) list.firstElementChild?.remove();
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  static #line(record: LogRecord): HTMLElement {
    const line = element('div', undefined, formatRecord(record));
    line.style.cssText = `white-space:pre-wrap;word-break:break-word;color:${LEVEL_COLOR[record.level]};`;
    return line;
  }

  #redraw(): void {
    const list = this.#list;
    if (list === undefined) return;
    const visible = this.#sink.records.filter((r) => this.#matches(r)).slice(-MAX_RENDERED_LINES);
    list.replaceChildren(...visible.map((r) => LogPanel.#line(r)));
    list.scrollTop = list.scrollHeight;
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#list = undefined;
  }
}
