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
    ({ id: w.id, title: w.name, subtitle: w.authorName, imageUrl: w.thumbnailImageUrl });
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
    ({ id: a.id, title: a.name, subtitle: a.authorName, imageUrl: a.thumbnailImageUrl });
  if (scope === 'own') return (await vrchat.ownAvatars()).map(item);
  if (scope === 'favorites') return (await vrchat.favoriteAvatars()).map(item);
  if (scope === 'recent') return (await vrchat.recentAvatars()).map(item);
  if (scope === 'search' && query.trim() !== '') return (await vrchat.searchAvatars(query)).results.map(item);
  return [];
}

async function loadGroups(vrchat: VrchatApi, scope: string, query: string): Promise<readonly PickItem[]> {
  const item = (g: { id: string; name: string; shortCode: string; iconUrl: string; memberCount: number }): PickItem =>
    ({ id: g.id, title: g.name, subtitle: `${g.shortCode === '' ? '' : `${g.shortCode} · `}${String(g.memberCount)} members`, imageUrl: g.iconUrl });
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

/** Opens the picker; resolves with the chosen ids, or `undefined` on cancel. */
export function openPicker(vrchat: VrchatApi, options: PickerOptions): Promise<readonly string[] | undefined> {
  const kind = options.kind;
  const scopes = entityScopes({ kind, label: '', default: '', ...(options.scopes === undefined ? {} : { scopes: options.scopes }) } as EntitySetting);
  const multiple = options.multiple === true;
  let chosen: string[] = [...(options.selected ?? [])];
  let scope = scopes[0] ?? 'search';
  let query = '';
  let generation = 0;
  const closer: { close?: (value: 'done' | 'cancel') => void } = {};

  const list = element('div', 'vrcnx-pick-list');
  const status = element('div', 'set-desc');
  const search = widgets.textField({ value: '', placeholder: `Search ${KIND_LABEL[kind]}s…`, onCommit: (next) => { query = next; void refresh(); } });
  search.style.flex = '1 1 auto';
  const manual = widgets.textField({
    value: '',
    placeholder: kind === 'instance' ? 'wrld_…:12345~…' : `${kind === 'user' ? 'usr' : kind === 'world' ? 'wrld' : kind === 'avatar' ? 'avtr' : 'grp'}_…`,
    onCommit: (next) => {
      const id = next.trim();
      if (id === '') return;
      chosen = multiple ? [...new Set([...chosen, id])] : [id];
      if (!multiple) closer.close?.('done');
      else void refresh();
    },
  });
  manual.style.flex = '1 1 auto';

  const toggle = (id: string): void => {
    if (!multiple) {
      chosen = [id];
      closer.close?.('done');
      return;
    }
    chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
    paint();
  };
  const paint = (): void => {
    for (const node of list.querySelectorAll<HTMLElement>('[data-id]')) {
      node.classList.toggle('vrcnx-picked', chosen.includes(node.dataset['id'] ?? ''));
    }
    status.textContent = multiple ? `${String(chosen.length)} chosen` : '';
  };
  const refresh = async (): Promise<void> => {
    const mine = ++generation;
    search.style.display = scope === 'search' ? '' : 'none';
    manual.style.display = scope === 'manual' ? '' : 'none';
    widgets.setChildren(list, [widgets.emptyState(scope === 'search' && query.trim() === '' ? 'Type to search.' : 'Loading…')]);
    let items: readonly PickItem[] = [];
    try {
      items = scope === 'manual' ? [] : await load(vrchat, kind, scope, query);
    } catch (error) {
      if (mine === generation) widgets.setChildren(list, [widgets.emptyState(`Could not load: ${error instanceof Error ? error.message : String(error)}`)]);
      return;
    }
    if (mine !== generation) return;
    const rows = items.map((item) => {
      const row = widgets.listItem({ ...item, onClick: () => { toggle(item.id); } });
      row.dataset['id'] = item.id;
      return row;
    });
    widgets.setChildren(list, rows.length === 0 ? [widgets.emptyState(scope === 'manual' ? 'Paste an id above.' : 'Nothing here.')] : rows);
    paint();
  };

  const chips = widgets.chips({
    options: scopes.map((s) => ({ value: s, label: SCOPE_LABEL[s] ?? s })),
    selected: [scope],
    multiple: false,
    onChange: (next) => { scope = next[0] ?? scope; void refresh(); },
  });
  chips.style.justifyContent = 'flex-start';
  const strip = widgets.controlRow(search, manual);
  void refresh();

  return showModal<'done' | 'cancel'>({
    title: options.title ?? `Choose ${multiple ? `${KIND_LABEL[kind]}s` : `a ${KIND_LABEL[kind]}`}`,
    icon: 'search',
    body: [chips, strip, list, status],
    buttons: multiple ? [{ label: 'Done', icon: 'check', value: 'done' }, { label: 'Cancel', value: 'cancel' }] : [{ label: 'Cancel', value: 'cancel' }],
    closer,
  }).then((answer) => (answer === 'done' ? chosen : undefined));
}

/** The settings-row control: the chosen things by name, with Choose and Clear. */
export function entityControl(spec: EntitySetting, binding: Binding, error: ReturnType<typeof widgets.errorLine>, ctx: FormContext): Control {
  const root = element('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:0;';
  const picked = element('div', 'vrcnx-picked-list');
  const read = (): readonly string[] => {
    const value = binding.get();
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    return typeof value === 'string' && value !== '' ? [value] : [];
  };
  const write = (ids: readonly string[]): void => { commit(binding, spec.multiple === true ? ids : (ids[0] ?? ''), error, ctx); };
  let generation = 0;

  const draw = (): void => {
    const ids = read();
    const mine = ++generation;
    if (ids.length === 0) {
      widgets.setChildren(picked, [widgets.value(spec.placeholder ?? 'Nothing chosen')]);
      return;
    }
    widgets.setChildren(picked, ids.map((id) => widgets.listItem({ title: id })));
    void Promise.all(ids.map((id) => describe(ctx.vrchat, spec.kind, id))).then((items) => {
      if (mine !== generation) return;
      widgets.setChildren(picked, items.map((item) => widgets.listItem({ ...item, subtitle: item.id })));
    });
  };
  const choose = widgets.button({
    label: 'Choose…',
    icon: 'search',
    onClick: () => {
      void openPicker(ctx.vrchat, {
        kind: spec.kind,
        multiple: spec.multiple === true,
        ...(spec.scopes === undefined ? {} : { scopes: spec.scopes }),
        selected: read(),
      }).then((ids) => { if (ids !== undefined) write(ids); });
    },
  });
  const clear = widgets.button({ label: 'Clear', icon: 'close', onClick: () => { write([]); } });
  root.append(picked, widgets.controlRow(choose, clear));
  draw();
  ctx.track(binding.onChange(draw));
  return { element: root, stacked: spec.multiple === true };
}
