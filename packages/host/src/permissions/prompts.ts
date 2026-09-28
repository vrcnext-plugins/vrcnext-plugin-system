/**
 * Builds the prompt for each kind of first use.
 *
 * The wording is the user-facing contract of the permission model, so it lives in one place:
 * every prompt names the plugin, says what it wants in plain words, and the details block carries
 * exactly what would be sent.
 *
 * A prompt is written in two pieces. `lead` is the verb phrase — "wants to request data from" —
 * and `headline` is the thing the answer actually turns on, usually a host. The modal shows the
 * headline on its own line so it cannot be skimmed past; `title` joins them for anything that
 * wants the sentence back. A detail whose value is empty is dropped rather than shown as
 * "(none)": a box saying nothing still costs a line and a glance.
 */

import { permissionInfo, type Permission } from '@vrcnext/plugin-api';

import { ANY_TARGET, type PluginSubject, type PromptDetail, type PromptRequest } from './types.js';

/** Longest detail value shown. Beyond this the text says how much was cut. */
const DETAIL_LIMIT = 4 * 1024;

function who(plugin: PluginSubject): string {
  return `Plugin ${plugin.name} (${plugin.id})`;
}

/** Stringify anything for the details block, truncating and saying so. */
export function detailText(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value === undefined) {
    text = '';
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      // Circular structures: a value that cannot be shown is still worth naming.
      text = '(value could not be serialised)';
    }
  }
  if (text.length <= DETAIL_LIMIT) return text;
  const cut = text.length - DETAIL_LIMIT;
  return `${text.slice(0, DETAIL_LIMIT)}\n… ${String(cut)} more characters not shown`;
}

interface Spec {
  readonly kind: Permission;
  readonly target: string;
  readonly lead: string;
  readonly headline?: string;
  readonly details?: readonly PromptDetail[];
}

function build(plugin: PluginSubject, spec: Spec): PromptRequest {
  const headline = spec.headline ?? '';
  return {
    plugin,
    ...spec,
    // The sentence still names the asker: it is what a log line or a narrow screen falls back to.
    title: `${who(plugin)} ${spec.lead}${headline === '' ? '' : ` ${headline}`}`,
    tone: permissionInfo(spec.kind).tone,
    // An empty value means the request carries none of that thing, which is worth no row at all.
    details: (spec.details ?? []).filter((detail) => detail.value !== ''),
  };
}

function headersText(headers: HeadersInit | undefined): string {
  if (headers === undefined) return '';
  const lines: string[] = [];
  new Headers(headers).forEach((value, name) => { lines.push(`${name}: ${value}`); });
  return lines.length === 0 ? '' : lines.join('\n');
}

export function networkPrompt(plugin: PluginSubject, url: URL, init: RequestInit | undefined): PromptRequest {
  const method = (init?.method ?? 'GET').toUpperCase();
  const reads = method === 'GET' || method === 'HEAD';
  const verb = reads ? 'request data from' : 'send data to';
  const body = init?.body;
  return build(plugin, {
    kind: 'network',
    target: url.host,
    lead: `wants to ${verb}`,
    headline: url.host,
    details: [
      // The method belongs in front of the URL, the way it is written everywhere else; on its own
      // it was a labelled box holding three characters.
      { label: 'Request', value: `${method} ${url.href}` },
      { label: 'Headers', value: headersText(init?.headers) },
      { label: 'Body', value: detailText(typeof body === 'string' ? body : body === undefined || body === null ? undefined : '(binary body)') },
    ],
  });
}

export function actionPrompt(plugin: PluginSubject, action: string, payload: unknown): PromptRequest {
  return build(plugin, {
    kind: 'host:actions',
    target: action,
    lead: 'wants to call the VRCNext action',
    headline: action,
    details: [{ label: 'Payload', value: detailText(payload) }],
  });
}

export function eventPrompt(plugin: PluginSubject, event: string): PromptRequest {
  const any = event === ANY_TARGET;
  return build(plugin, {
    kind: 'host:events',
    target: event,
    lead: any ? 'wants to listen to every VRCNext event' : 'wants to listen to the VRCNext event',
    ...(any ? {} : { headline: event }),
  });
}

export function interceptPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, {
    kind: 'host:intercept',
    target: ANY_TARGET,
    lead: 'wants to observe and drop actions VRCNext sends to its backend',
  });
}

export function bridgePrompt(
  plugin: PluginSubject,
  service: string,
  method: string,
  params: unknown,
): PromptRequest {
  const target = `${service}/${method}`;
  return build(plugin, {
    kind: 'native',
    target,
    lead: 'wants to call the bridge:',
    headline: target,
    details: [{ label: 'Parameters', value: detailText(params) }],
  });
}

export function oscPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, { kind: 'osc', target: ANY_TARGET, lead: 'wants to send and receive OSC through VRCNext' });
}

export function gamelogPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, { kind: 'gamelog', target: ANY_TARGET, lead: 'wants to read the VRChat game log' });
}

export function vrchatPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, {
    kind: 'vrchat',
    target: ANY_TARGET,
    lead: 'wants to read VRChat data through VRCNext',
    details: [{ label: 'What that allows', value: permissionInfo('vrchat').description }],
  });
}

export function clipboardPrompt(plugin: PluginSubject, direction: 'read' | 'write'): PromptRequest {
  const verb = direction === 'read' ? 'read the clipboard' : 'write to the clipboard';
  return build(plugin, { kind: 'clipboard', target: direction, lead: `wants to ${verb}` });
}

/** `ctx.permissions.request(p)` for an optional category: the ceiling, not a concrete target. */
export function categoryPrompt(plugin: PluginSubject, permission: Permission): PromptRequest {
  return build(plugin, {
    kind: permission,
    target: ANY_TARGET,
    lead: 'wants to use',
    headline: permission,
    details: [{ label: 'What that allows', value: permissionInfo(permission).description }],
  });
}
