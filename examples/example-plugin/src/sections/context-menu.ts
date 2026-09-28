/**
 * Context-menu items, dividers and submenus.
 *
 * `contribute` is called each time a menu opens, with what was right-clicked, so the entries can
 * depend on the target. The clipboard is its own category and asks the first time.
 */

import type { ContextMenuEntry } from '@vrcnext/plugin-api';

import { settings } from '../settings.js';
import type { Ctx, State } from '../state.js';

export function installContextMenu(ctx: Ctx, state: State): void {
  ctx.contextMenu.contribute((target) => {
    const entries: ContextMenuEntry[] = [
      { kind: 'divider' },
      {
        kind: 'item',
        icon: 'auto_awesome',
        label: 'Example: log this element',
        onSelect: () => {
          state.log(`[ctx] ${target.element.tagName.toLowerCase()}`);
        },
      },
      {
        kind: 'submenu',
        icon: 'tune',
        label: 'Example: verbosity',
        items: () =>
          settings.verbosity.options.map(
            (option): ContextMenuEntry => ({
              kind: 'item',
              icon: 'adjust',
              label: option.label,
              checked: ctx.settings.get('verbosity') === option.value,
              onSelect: () => {
                void ctx.settings.set('verbosity', option.value);
              },
            }),
          ),
      },
    ];

    if (target.entity !== undefined) {
      const entity = target.entity;
      entries.push({
        kind: 'item',
        icon: 'content_copy',
        label: `Copy ${entity.type} id`,
        onSelect: async () => {
          await ctx.clipboard.writeText(entity.id);
        },
      });
    }
    return entries;
  });
}
