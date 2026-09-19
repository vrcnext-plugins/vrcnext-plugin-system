/**
 * Small scrolling log view used by the Kitchen Sink tab.
 *
 * Kept in its own module to show the normal pattern: UI helpers separate from the plugin's
 * lifecycle wiring, so `index.ts` stays readable.
 */

const MAX_LINES = 200;

export interface LogPanel {
  append(message: string): void;
  clear(): void;
}

export function createLogPanel(parent: HTMLElement): LogPanel {
  const list = document.createElement('div');
  list.className = 'ks-log';
  parent.appendChild(list);

  return {
    append(message: string): void {
      const line = document.createElement('div');
      line.className = 'ks-log-line';
      const time = new Date().toLocaleTimeString();
      line.textContent = `${time}  ${message}`;
      list.appendChild(line);

      while (list.childElementCount > MAX_LINES) list.firstElementChild?.remove();

      // Only chase the tail when the user has not scrolled up to read history.
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      if (atBottom) list.scrollTop = list.scrollHeight;
    },

    clear(): void {
      list.replaceChildren();
    },
  };
}
