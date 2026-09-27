/**
 * Builds the prompt for each kind of first use.
 *
 * The wording is the user-facing contract of the permission model, so it lives in one place:
 * every title starts with the plugin's name and id, says what it wants in plain words, and the
 * details block carries exactly what would be sent.
 */

import { permissionInfo, type Permission } from '@vrcnext/plugin-api';

import { ANY_TARGET, type PluginSubject, type PromptDetail, type PromptRequest } from './types.js';

/** Longest detail value shown. Beyond this the text says how much was cut. */
const DETAIL_LIMIT = 4 * 1024;

function who(plugin: PluginSubject): string {
  return `Plugin ${plugin.name} (${plugin.id}) wants to`;
}

/** Stringify anything for the details block, truncating and saying so. */
export function detailText(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value === undefined) {
    text = '(none)';
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
  readonly title: string;
  readonly details?: readonly PromptDetail[];
}

function build(plugin: PluginSubject, spec: Spec): PromptRequest {
  return { plugin, ...spec, tone: permissionInfo(spec.kind).tone, details: spec.details ?? [] };
}

function headersText(headers: HeadersInit | undefined): string {
  if (headers === undefined) return '(none)';
  const lines: string[] = [];
  new Headers(headers).forEach((value, name) => { lines.push(`${name}: ${value}`); });
  return lines.length === 0 ? '(none)' : lines.join('\n');
}

export function networkPrompt(plugin: PluginSubject, url: URL, init: RequestInit | undefined): PromptRequest {
  const method = (init?.method ?? 'GET').toUpperCase();
  const reads = method === 'GET' || method === 'HEAD';
  const verb = reads ? 'request data from' : 'send data to';
  const body = init?.body;
  return build(plugin, {
    kind: 'network',
    target: url.host,
    title: `${who(plugin)} ${verb} ${url.host}`,
    details: [
      { label: 'Method', value: method },
      { label: 'URL', value: url.href },
      { label: 'Headers', value: headersText(init?.headers) },
      { label: 'Body', value: detailText(typeof body === 'string' ? body : body === undefined || body === null ? undefined : '(binary body)') },
    ],
  });
}

export function actionPrompt(plugin: PluginSubject, action: string, payload: unknown): PromptRequest {
  return build(plugin, {
    kind: 'host:actions',
    target: action,
    title: `${who(plugin)} call VRCNext action ${action}`,
    details: [{ label: 'Payload', value: detailText(payload) }],
  });
}

export function eventPrompt(plugin: PluginSubject, event: string): PromptRequest {
  const title =
    event === ANY_TARGET
      ? `${who(plugin)} listen to every VRCNext event`
      : `${who(plugin)} listen to ${event}`;
  return build(plugin, { kind: 'host:events', target: event, title });
}

export function interceptPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, {
    kind: 'host:intercept',
    target: ANY_TARGET,
    title: `${who(plugin)} observe and drop actions VRCNext sends to its backend`,
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
    title: `${who(plugin)} call the bridge: ${target}`,
    details: [{ label: 'Parameters', value: detailText(params) }],
  });
}

export function oscPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, { kind: 'osc', target: ANY_TARGET, title: `${who(plugin)} send and receive OSC through VRCNext` });
}

export function gamelogPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, { kind: 'gamelog', target: ANY_TARGET, title: `${who(plugin)} read the VRChat game log` });
}

export function vrchatPrompt(plugin: PluginSubject): PromptRequest {
  return build(plugin, {
    kind: 'vrchat',
    target: ANY_TARGET,
    title: `${who(plugin)} read VRChat data through VRCNext`,
    details: [{ label: 'What that allows', value: permissionInfo('vrchat').description }],
  });
}

export function clipboardPrompt(plugin: PluginSubject, direction: 'read' | 'write'): PromptRequest {
  const verb = direction === 'read' ? 'read the clipboard' : 'write to the clipboard';
  return build(plugin, { kind: 'clipboard', target: direction, title: `${who(plugin)} ${verb}` });
}

/** `ctx.permissions.request(p)` for an optional category: the ceiling, not a concrete target. */
export function categoryPrompt(plugin: PluginSubject, permission: Permission): PromptRequest {
  return build(plugin, {
    kind: permission,
    target: ANY_TARGET,
    title: `${who(plugin)} use ${permission}`,
    details: [{ label: 'What that allows', value: permissionInfo(permission).description }],
  });
}
