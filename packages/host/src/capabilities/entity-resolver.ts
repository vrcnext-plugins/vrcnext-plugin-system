/**
 * Resolves the VRChat entity behind a right-clicked element.
 *
 * VRCNext does not tag its cards with a uniform attribute. Its own `getMenuConfig` walks a long
 * list of selectors and then reads the id out of either an inline `onclick` handler
 * (`openFriendDetail('usr_…')`, `navOpenModal('world','wrld_…')`, `selectAvatar('avtr_…')`, …)
 * or one of several `data-*` attributes (`data-uid`, `data-wid`, `data-avid`, `data-gid`,
 * `data-user-id`, `data-world-id`, `data-avatar-id`, `data-group-id`, `data-location`).
 *
 * Rather than mirror that selector table, which would break on every layout change, this walks
 * the ancestors from the target outward and takes the first prefixed VRChat id it finds in
 * either place. The prefix (`usr_`, `wrld_`, `avtr_`, `grp_`) identifies the type, and an
 * instance location (`wrld_…:12345~…`) is recognised as an instance. That is the same data
 * VRCNext reads, found the same way, without depending on where a card happens to live.
 */

import type { ContextMenuTarget } from '@vrcnext/plugin-api';

type Entity = NonNullable<ContextMenuTarget['entity']>;

const PREFIX_TYPES: ReadonlyMap<string, Entity['type']> = new Map([
  ['usr', 'user'],
  ['wrld', 'world'],
  ['avtr', 'avatar'],
  ['grp', 'group'],
]);

/** A bare VRChat id: prefix plus a UUID. VRChat's legacy ids for early accounts have no UUID. */
const ID_PATTERN = /\b(usr|wrld|avtr|grp)_[0-9a-zA-Z-]{8,}\b/g;

/** `wrld_<uuid>:<instance>` optionally followed by `~` modifiers. */
const LOCATION_PATTERN = /^wrld_[0-9a-f-]{36}:[^\s'"]+$/i;

/** Attributes VRCNext uses to carry an instance location on a card. */
const LOCATION_ATTRS = ['location', 'loc'] as const;

/** How far up to look. Cards are shallow; a deeper walk only finds unrelated containers. */
const MAX_DEPTH = 12;

function entityFromId(id: string): Entity | undefined {
  const prefix = id.slice(0, id.indexOf('_'));
  const type = PREFIX_TYPES.get(prefix);
  return type === undefined ? undefined : { type, id };
}

function locationOf(element: HTMLElement): string | undefined {
  for (const attr of LOCATION_ATTRS) {
    const value = element.dataset[attr];
    if (value !== undefined && LOCATION_PATTERN.test(value)) return value;
  }
  return undefined;
}

/**
 * First VRChat id in any `data-*` value, then in the inline `onclick`.
 *
 * Data attributes win because they are set for the element itself, while an `onclick` can wrap
 * several children with different ids. Both scans stop at the first match, which is the id
 * nearest the start of the attribute, matching VRCNext's own `match(...)[1]` reads.
 */
function entityOnElement(element: HTMLElement): Entity | undefined {
  const location = locationOf(element);
  if (location !== undefined) return { type: 'instance', id: location };

  for (const value of Object.values(element.dataset)) {
    if (value === undefined) continue;
    const match = ID_PATTERN.exec(value);
    ID_PATTERN.lastIndex = 0;
    if (match !== null) return entityFromId(match[0]);
  }

  const onclick = element.getAttribute('onclick');
  if (onclick === null) return undefined;
  const match = ID_PATTERN.exec(onclick);
  ID_PATTERN.lastIndex = 0;
  return match === null ? undefined : entityFromId(match[0]);
}

/** The nearest entity VRCNext associated with `element` or one of its ancestors. */
export function resolveEntity(element: HTMLElement): ContextMenuTarget['entity'] {
  let current: HTMLElement | null = element;
  for (let depth = 0; current !== null && depth < MAX_DEPTH; depth += 1) {
    const entity = entityOnElement(current);
    if (entity !== undefined) return entity;
    current = current.parentElement;
  }
  return undefined;
}
