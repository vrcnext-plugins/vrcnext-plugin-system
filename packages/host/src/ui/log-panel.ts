/**
 * Live log viewer for the Plugins tab.
 *
 * Exists because VRCNext's activity-log file is not writable from the page — this, plus the
 * download button, is how a user follows plugin activity without opening devtools.
 */

import type { LogLevel } from '@vrcnext/plugin-api';

import { formatRecord, LEVEL_ORDER, type LogRecord, type LogSink } from '../log/log-sink.js';
import { CLASSES, element, iconSpan } from './dom.js';

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

    const list = element('div');
    list.style.cssText =
      'max-height:320px;overflow-y:auto;background:var(--bg-input);border-radius:8px;' +
      'padding:8px 10px;font-family:ui-monospace,monospace;' +
      'font-size:calc(11px + var(--fs-off, 0px));';
    this.#list = list;
    card.appendChild(list);

    this.#redraw();
    this.#unsubscribe = this.#sink.subscribe((record) => { this.#onRecord(record); });
  }

  #buildControls(): HTMLElement {
    const row = element('div', CLASSES.toggleRow);

    const level = element('select');
    for (const value of LEVELS) {
      const option = element('option', undefined, value.toUpperCase());
      option.value = value;
      level.appendChild(option);
    }
    level.value = this.#minLevel;
    level.addEventListener('change', () => {
      this.#minLevel = LEVELS.find((l) => l === level.value) ?? 'debug';
      this.#redraw();
    });

    const scope = element('select');
    const refreshScopes = (): void => {
      const current = scope.value;
      scope.replaceChildren();
      const all = element('option', undefined, 'All plugins');
      all.value = '';
      scope.appendChild(all);
      for (const name of this.#sink.scopes()) {
        const option = element('option', undefined, name);
        option.value = name;
        scope.appendChild(option);
      }
      scope.value = current;
    };
    refreshScopes();
    scope.addEventListener('mousedown', refreshScopes);
    scope.addEventListener('change', () => {
      this.#scope = scope.value;
      this.#redraw();
    });

    const copy = element('button', undefined, 'Copy');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.#text());
    });

    const download = element('button', undefined, 'Download');
    download.addEventListener('click', () => { this.#download(); });

    const clear = element('button', undefined, 'Clear');
    clear.addEventListener('click', () => {
      this.#sink.clear();
      this.#redraw();
    });

    row.append(iconSpan('article'), level, scope, copy, download, clear);
    return row;
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
