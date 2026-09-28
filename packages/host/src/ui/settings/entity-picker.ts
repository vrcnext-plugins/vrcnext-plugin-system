/**
 * The picker behind `user`, `world`, `avatar`, `group` and `instance` settings, and behind
 * `ctx.ui.pickEntity`.
 *
 * A modal with one chip per scope (friends, favourites, recent, search, …), a search field
 * where the scope needs one, and VRCNext's own compact profile rows for the results. Every list
 * comes from the host's {@link VrchatApi}, which reads VRCNext's data quietly, so opening the
 * picker never changes what is on screen behind it.
 */

import {
  entityScopes,
  type EntityKind,
  type EntitySetting,
  type VrchatApi,
} from '@vrcnext/plugin-api';

import { element } from '../dom.js';
import { showModal } from '../modal.js';
import * as widgets from '../widgets.js';
import type { Binding } from './binding.js';
import type { Control, FormContext } from './form.js';
import { commit } from './form.js';

export interface PickItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly imageUrl?: string;
  readonly badge?: string;
}

export interface PickerOptions {
  readonly kind: EntityKind;
  readonly title?: string;
  readonly multiple?: boolean;
  readonly scopes?: readonly string[];
  readonly selected?: readonly string[];
}

const KIND_LABEL: Readonly<Record<EntityKind, string>> = {
  user: 'user', world: 'world', avatar: 'avatar', group: 'group', instance: 'instance',
};

const SCOPE_LABEL: Readonly<Record<string, string>> = {
  friends: 'Friends', favorites: 'Favourites', recent: 'Recent', instance: 'In my instance',
  search: 'Search', current: 'Current', own: 'Mine', mine: 'My groups', manual: 'Paste an id',
};

/**
 * A name to show. VRCNext stores `???` for a favourite whose world it has not resolved, and an
 * empty name for anything it only knows by id; neither is worth showing as a title.
 */
function named(name: string, kind: EntityKind): string {
  return isBlank(name) ? `Unknown ${KIND_LABEL[kind]}` : name.trim();
}

/** VRCNext writes `???` where it has no answer, so that counts as nothing. */
function isBlank(text: string): boolean {
  const clean = text.trim();
  return clean === '' || clean === '???';
}

/** The second line of a row: who made it, or the id when that is all there is. */
function author(name: string, id: string): string {
  return isBlank(name) ? id : name.trim();
}

function instanceTitle(location: string, worldName: string): string {
  const shape = location.split(':');
  return `${worldName === '' ? (shape[0] ?? location) : worldName} #${(shape[1] ?? '').split('~')[0] ?? ''}`;
}

/** Everything a scope can list, or the results of a search when the scope is `search`. */
async function load(vrchat: VrchatApi, kind: EntityKind, scope: string, query: string): Promise<readonly PickItem[]> {
  switch (kind) {
    case 'user': return loadUsers(vrchat, scope, query);
    case 'world': return loadWorlds(vrchat, scope, query);
    case 'avatar': return loadAvatars(vrchat, scope, query);
    case 'group': return loadGroups(vrchat, scope, query);
    case 'instance': return loadInstances(vrchat, scope);
  }
}

async function loadUsers(vrchat: VrchatApi, scope: string, query: string): Promise<readonly PickItem[]> {
  const item = (u: { id: string; displayName: string; imageUrl: string; statusDescription: string; isFriend: boolean }): PickItem =>
    ({ id: u.id, title: u.displayName, subtitle: u.statusDescription, imageUrl: u.imageUrl, ...(u.isFriend ? { badge: 'Friend' } : {}) });
  if (scope === 'friends') return (await vrchat.friends()).map(item);
  if (scope === 'favorites') return (await vrchat.favoriteFriends()).map(item);
  if (scope === 'recent') return (await vrchat.recentPlayers()).map(item);
  if (scope === 'instance') {
    const instance = await vrchat.currentInstance();
    return (instance?.users ?? []).filter((u) => u.id !== '').map((u) => ({ id: u.id, title: u.displayName, imageUrl: u.imageUrl, subtitle: u.platform }));
  }
  if (scope === 'search' && query.trim() !== '') return (await vrchat.searchUsers(query)).results.map(item);
  return [];
}

async function loadWorlds(vrchat: VrchatApi, scope: string, query: string): Promise<readonly PickItem[]> {
  const item = (w: { id: string; name: string; authorName: string; thumbnailImageUrl: string }): PickItem =>
    ({ id: w.id, title: named(w.name, 'world'), subtitle: author(w.authorName, w.id), imageUrl: w.thumbnailImageUrl });
  if (scope === 'favorites') return (await vrchat.favoriteWorlds()).map(item);
  if (scope === 'recent') return (await vrchat.recentWorlds()).map(item);
  if (scope === 'current') {
    const instance = await vrchat.currentInstance();
    return instance === undefined ? [] : [{ id: instance.worldId, title: instance.worldName, imageUrl: instance.worldThumbnailUrl }];
  }
  if (scope === 'search' && query.trim() !== '') return (await vrchat.searchWorlds(query)).results.map(item);
  return [];
}

async function loadAvatars(vrchat: VrchatApi, scope: string, query: string): Promise<readonly PickItem[]> {
  const item = (a: { id: string; name: string; authorName: string; thumbnailImageUrl: string }): PickItem =>
    ({ id: a.id, title: named(a.name, 'avatar'), subtitle: author(a.authorName, a.id), imageUrl: a.thumbnailImageUrl });
  if (scope === 'own') return (await vrchat.ownAvatars()).map(item);
  if (scope === 'favorites') return (await vrchat.favoriteAvatars()).map(item);
  if (scope === 'recent') return (await vrchat.recentAvatars()).map(item);
  if (scope === 'search' && query.trim() !== '') return (await vrchat.searchAvatars(query)).results.map(item);
  return [];
}

async function loadGroups(vrchat: VrchatApi, scope: string, query: string): Promise<readonly PickItem[]> {
  const item = (g: { id: string; name: string; shortCode: string; iconUrl: string; memberCount: number }): PickItem =>
    ({ id: g.id, title: named(g.name, 'group'), subtitle: `${g.shortCode === '' ? '' : `${g.shortCode} · `}${String(g.memberCount)} members`, imageUrl: g.iconUrl });
  if (scope === 'mine') return (await vrchat.myGroups()).map(item);
  if (scope === 'search' && query.trim() !== '') return (await vrchat.searchGroups(query)).results.map(item);
  return [];
}

async function loadInstances(vrchat: VrchatApi, scope: string): Promise<readonly PickItem[]> {
  if (scope === 'current') {
    const instance = await vrchat.currentInstance();
    return instance === undefined
      ? []
      : [{ id: instance.location, title: instanceTitle(instance.location, instance.worldName), subtitle: instance.instanceType, imageUrl: instance.worldThumbnailUrl }];
  }
  if (scope === 'friends') {
    return (await vrchat.friendInstances()).map((i) => ({
      id: i.location,
      title: instanceTitle(i.location, i.worldName),
      subtitle: `${i.instanceType} · ${i.friends.map((f) => f.displayName).join(', ')}`,
    }));
  }
  return [];
}

/** A name for an id, from the cheapest source that knows it. */
export async function describe(vrchat: VrchatApi, kind: EntityKind, id: string): Promise<PickItem> {
  const fallback: PickItem = { id, title: id };
  try {
    switch (kind) {
      case 'user': {
        const user = await vrchat.userBasic(id);
        return user === undefined ? fallback : { id, title: user.displayName, imageUrl: user.imageUrl, subtitle: user.statusDescription };
      }
      case 'world': {
        const world = await vrchat.world(id);
        return world === undefined ? fallback : { id, title: world.name, imageUrl: world.thumbnailImageUrl, subtitle: world.authorName };
      }
      case 'avatar': {
        const avatar = await vrchat.avatar(id);
        return avatar === undefined ? fallback : { id, title: avatar.name, imageUrl: avatar.thumbnailImageUrl, subtitle: avatar.authorName };
      }
      case 'group': {
        const group = await vrchat.group(id);
        return group === undefined ? fallback : { id, title: group.name, imageUrl: group.iconUrl, subtitle: group.shortCode };
      }
      case 'instance': {
        const worldId = id.split(':')[0] ?? '';
        const world = worldId === '' ? undefined : await vrchat.world(worldId);
        return { id, title: instanceTitle(id, world?.name ?? ''), ...(world === undefined ? {} : { imageUrl: world.thumbnailImageUrl }) };
      }
    }
  } catch {
    return fallback;
  }
}

/** Everything typed into the filter matches against, lower-cased once per row. */
function haystack(item: PickItem): string {
  return `${item.title} ${item.subtitle ?? ''} ${item.id}`.toLowerCase();
}

/**
 * The list inside the picker: what was loaded, what the filter leaves of it, and what is
 * chosen. Kept apart from {@link openPicker} because the filter has to redraw without
 * re-fetching, and because "what is on screen" is the only state worth naming here.
 */
class PickerList {
  readonly element = element('div', 'vrcnx-pick-list');
  readonly status = element('div', 'set-desc');
  #loaded: readonly PickItem[] = [];
  #filter = '';
  #empty = 'Nothing here.';

  readonly #multiple: boolean;
  readonly #chosen: () => readonly string[];
  readonly #onPick: (id: string) => void;

  constructor(multiple: boolean, chosen: () => readonly string[], onPick: (id: string) => void) {
    this.#multiple = multiple;
    this.#chosen = chosen;
    this.#onPick = onPick;
    this.status.style.margin = '6px 0 0';
  }

  /** Replaces what is loaded and redraws; the filter survives a reload of the same scope. */
  setItems(items: readonly PickItem[], empty: string): void {
    this.#loaded = items;
    this.#empty = empty;
    this.draw();
  }

  setFilter(text: string): void {
    this.#filter = text.trim().toLowerCase();
    this.draw();
  }

  /** A message instead of rows: loading, an error, or "type to search". */
  say(message: string): void {
    this.#loaded = [];
    widgets.setChildren(this.element, [widgets.emptyState(message)]);
    this.status.textContent = '';
  }

  #shown(): readonly PickItem[] {
    return this.#loaded.filter((item) => haystack(item).includes(this.#filter));
  }

  draw(): void {
    const shown = this.#shown();
    if (shown.length === 0) {
      widgets.setChildren(this.element, [
        widgets.emptyState(this.#loaded.length === 0 ? this.#empty : 'Nothing matches that.'),
      ]);
    } else {
      widgets.setChildren(this.element, shown.map((item) => {
        const row = widgets.listItem({ ...item, onClick: () => { this.#onPick(item.id); } });
        row.dataset['id'] = item.id;
        return row;
      }));
    }
    this.paint();
  }

  /** Marks the chosen rows and updates the count, without rebuilding anything. */
  paint(): void {
    const chosen = this.#chosen();
    for (const node of this.element.querySelectorAll<HTMLElement>('[data-id]')) {
      node.classList.toggle('vrcnx-picked', chosen.includes(node.dataset['id'] ?? ''));
    }
    const shown = this.#shown();
    const counts = this.#filter === ''
      ? `${String(this.#loaded.length)} shown`
      : `${String(shown.length)} of ${String(this.#loaded.length)}`;
    this.status.textContent = this.#multiple ? `${String(chosen.length)} chosen · ${counts}` : counts;
  }
}

function idPlaceholder(kind: EntityKind): string {
  if (kind === 'instance') return 'wrld_…:12345~…';
  const prefix = kind === 'user' ? 'usr' : kind === 'world' ? 'wrld' : kind === 'avatar' ? 'avtr' : 'grp';
  return `${prefix}_…`;
}

/** Opens the picker; resolves with the chosen ids, or `undefined` on cancel. */
export function openPicker(vrchat: VrchatApi, options: PickerOptions): Promise<readonly string[] | undefined> {
  const kind = options.kind;
  const scopes = entityScopes({ kind, label: '', default: '', ...(options.scopes === undefined ? {} : { scopes: options.scopes }) } as EntitySetting);
  const multiple = options.multiple === true;
  let chosen: string[] = [...(options.selected ?? [])];
  let scope = scopes[0] ?? 'search';
  let generation = 0;
  const closer: { close?: (value: 'done' | 'cancel') => void } = {};

  const list = new PickerList(multiple, () => chosen, (id) => {
    if (!multiple) {
      chosen = [id];
      closer.close?.('done');
      return;
    }
    chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
    list.paint();
  });

  const refresh = async (query = ''): Promise<void> => {
    const mine = ++generation;
    manual.style.display = scope === 'manual' ? '' : 'none';
    search.style.display = scope === 'manual' ? 'none' : '';
    search.placeholder = scope === 'search' ? `Search ${KIND_LABEL[kind]}s…` : `Filter ${KIND_LABEL[kind]}s…`;
    if (scope === 'manual') {
      list.say('Paste an id above.');
      return;
    }
    if (scope === 'search' && query.trim() === '') {
      list.say('Type a name and press Enter.');
      return;
    }
    list.say('Loading…');
    try {
      const items = await load(vrchat, kind, scope, query);
      if (mine === generation) list.setItems(items, 'Nothing here.');
    } catch (error) {
      if (mine === generation) list.say(`Could not load: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // One field, always there. For a list scope it narrows what is already loaded as you type;
  // for `search` it is the query VRChat is asked for, on Enter. A hundred favourite worlds are
  // unusable without it, which is what this picker used to be.
  const search = widgets.textField({
    value: '',
    placeholder: `Filter ${KIND_LABEL[kind]}s…`,
    onInput: (next) => { list.setFilter(next); },
    onCommit: (next) => { if (scope === 'search') void refresh(next); },
  });
  search.style.flex = '1 1 auto';

  const manual = widgets.textField({
    value: '',
    placeholder: idPlaceholder(kind),
    onCommit: (next) => {
      const id = next.trim();
      if (id === '') return;
      chosen = multiple ? [...new Set([...chosen, id])] : [id];
      if (!multiple) closer.close?.('done');
      else list.paint();
    },
  });
  manual.style.flex = '1 1 auto';

  const chips = widgets.chips({
    options: scopes.map((s) => ({ value: s, label: SCOPE_LABEL[s] ?? s })),
    selected: [scope],
    multiple: false,
    onChange: (next) => {
      scope = next[0] ?? scope;
      search.value = '';
      list.setFilter('');
      void refresh();
    },
  });
  // The chips choose what is listed and the field narrows it: two steps, not one control in two
  // halves. Flush against each other they read as one, and the field looks like part of the row.
  chips.style.marginBottom = '10px';
  void refresh();

  return showModal<'done' | 'cancel'>({
    title: options.title ?? `Choose ${multiple ? `${KIND_LABEL[kind]}s` : `a ${KIND_LABEL[kind]}`}`,
    icon: 'search',
    body: [chips, widgets.controlRow(search, manual), list.element, list.status],
    buttons: multiple ? [{ label: 'Done', icon: 'check', value: 'done' }, { label: 'Cancel', value: 'cancel' }] : [{ label: 'Cancel', value: 'cancel' }],
    closer,
  }).then((answer) => (answer === 'done' ? chosen : undefined));
}

/**
 * The settings-row control: what is chosen, by name, above one button.
 *
 * Laid out as a block under the label rather than as a value at the end of the row, because a
 * chosen world is a profile row, not a word. Each one carries its own ×, so there is no Clear
 * button to sit there greyed out when nothing is chosen, and the raw id is shown only while the
 * name is still unknown — an id is what the plugin stores, not what the user picked.
 */
export function entityControl(spec: EntitySetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const multiple = spec.multiple === true;
  const root = element('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0;';
  const picked = element('div', 'vrcnx-picked-list');
  const read = (): readonly string[] => {
    const value = binding.get();
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    return typeof value === 'string' && value !== '' ? [value] : [];
  };
  const write = (ids: readonly string[]): void => { commit(binding, multiple ? ids : (ids[0] ?? ''), error, ctx); };
  let generation = 0;

  const remove = (id: string): void => { write(read().filter((other) => other !== id)); };

  /** One chosen thing: VRCNext's compact profile row, plus a × that forgets it. */
  const pickedRow = (item: PickItem): HTMLElement => {
    const row = element('div', 'vrcnx-picked-row');
    row.append(
      widgets.listItem({
        title: item.title,
        // While the name is unknown the id is all there is to show; once it is known the id is
        // noise, so it only survives as the row's tooltip.
        ...(item.title === item.id ? {} : { subtitle: item.subtitle ?? '' }),
        ...(item.imageUrl === undefined ? {} : { imageUrl: item.imageUrl }),
      }),
      widgets.iconButton('close', `Remove ${item.title}`, () => { remove(item.id); }),
    );
    row.title = item.id;
    return row;
  };

  // Sits beside the button rather than on a line of its own: an empty picker should cost two
  // lines, not three, and there are four of them in one Club Security preset.
  const hint = element('span', 'set-desc', spec.placeholder ?? 'Nothing chosen');
  hint.style.margin = '0';

  const draw = (): void => {
    const ids = read();
    const mine = ++generation;
    hint.style.display = ids.length === 0 ? '' : 'none';
    if (ids.length === 0) {
      widgets.setChildren(picked, []);
      return;
    }
    widgets.setChildren(picked, ids.map((id) => pickedRow({ id, title: id })));
    void Promise.all(ids.map((id) => describe(ctx.vrchat, spec.kind, id))).then((items) => {
      if (mine !== generation) return;
      widgets.setChildren(picked, items.map(pickedRow));
    });
  };

  const choose = widgets.button({
    label: multiple ? 'Choose…' : 'Choose…',
    icon: 'search',
    onClick: () => {
      void openPicker(ctx.vrchat, {
        kind: spec.kind,
        multiple,
        ...(spec.scopes === undefined ? {} : { scopes: spec.scopes }),
        selected: read(),
      }).then((ids) => { if (ids !== undefined) write(ids); });
    },
  });
  const actions = element('div');
  actions.style.cssText = 'display:flex;justify-content:flex-start;align-items:center;gap:10px;min-width:0;';
  actions.append(choose, hint);
  root.append(picked, actions);
  draw();
  ctx.track(binding.onChange(draw));
  return { element: root, stacked: true };
}
