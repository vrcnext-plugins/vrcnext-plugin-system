/**
 * Formats a report and fans it out to every enabled channel.
 *
 * Channels:
 * - In-app toast: always available.
 * - Desktop and VR: on any platform through the VRCNext Bridge, whose targets are addressed by
 *   name; on Windows when the bridge delivers nothing, VRCNext's own tray toast plus SteamVR wrist overlay,
 *   which is a single action that reaches both.
 * - Discord: a webhook POST through `ctx.http.fetch`. Only `discord.com` is in the manifest's
 *   `hosts`, so that is the only webhook host accepted here.
 */

import {
  TemplateError,
  renderTemplate,
  timeAgo,
  type PluginContext,
  type SettingsValues,
  type TemplateValues,
} from '@vrcnext/plugin-api';

import type { Facts, Joiner } from './collector.js';
import type { Rejoin } from './history.js';
import { DEFAULT_TEMPLATE, type Settings } from './settings.js';
import type { CurrentInstance } from './vrcnext-data.js';

export interface Report {
  readonly at: number;
  readonly joiner: Joiner;
  readonly instance: CurrentInstance;
  readonly facts: Facts;
  /** Whether a group filter was active, so the "In Group" line is only shown when it means something. */
  readonly groupFilter: string;
}

type Ctx = PluginContext<Settings>;

/** Matches the host declared in plugin.json; `ptb.`/`canary.` would need their own entries. */
const DISCORD_WEBHOOK = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function yesNo(value: boolean | undefined, unknown = 'Unknown'): string {
  if (value === undefined) return unknown;
  return value ? 'Yes' : 'No';
}

function rank(value: string): string {
  return value === '' ? 'Unknown' : value;
}

/** `Yes (2 hours ago)`: this player was in this exact instance with you before, per VRCNext's timeline. */
function rejoinText(rejoin: Rejoin): string {
  if (rejoin.seenHere === undefined) return 'Unknown';
  if (!rejoin.seenHere) return 'No';
  return rejoin.lastAt === undefined ? 'Yes' : `Yes (${timeAgo(rejoin.lastAt)})`;
}

/** VRChat's performance rank colours, as emoji. */
const RANK_EMOJI: Readonly<Record<string, string>> = {
  Excellent: '🟢', Good: '🔵', Medium: '🟡', Poor: '🟠', VeryPoor: '🔴',
};

const PLATFORM_EMOJI: readonly (readonly [RegExp, string])[] = [
  [/windows/i, '🖥️'], [/android|quest/i, '📱'], [/ios/i, '🍎'],
];

function triState(value: boolean | undefined, yes: string, no: string, unknown = '❔'): string {
  return value === undefined ? unknown : (value ? yes : no);
}

/**
 * Everything a template may name. `undefined` means "not applicable", so a line that only
 * shows that value is dropped. Three flavours per fact: the boolean for conditions, `…Text` for
 * the spec's wording, `…Emoji` for compact formats.
 */
export function reportValues(report: Report): TemplateValues {
  const { facts, joiner, instance } = report;
  const groupFiltered = report.groupFilter !== '';
  const pc = facts.avatar?.pc ?? '';
  const quest = facts.avatar?.quest ?? '';
  const seenHere = facts.rejoin.seenHere;
  const at = new Date(report.at);
  return {
    name: joiner.name,
    playerId: joiner.userId,
    userId: joiner.userId,
    ageVerified: facts.ageVerified,
    ageVerifiedText: facts.ageVerified === undefined
      ? 'Unknown'
      : `${yesNo(facts.ageVerified)}${facts.ageStatus === '' ? '' : ` (${facts.ageStatus})`}`,
    ageVerifiedEmoji: triState(facts.ageVerified, '✅', '❌'),
    ageStatus: facts.ageStatus,
    pcRank: pc === '' ? undefined : pc,
    pcRankText: rank(pc),
    pcRankEmoji: RANK_EMOJI[pc] ?? '⚪',
    questRank: quest === '' ? undefined : quest,
    questRankText: rank(quest),
    questRankEmoji: RANK_EMOJI[quest] ?? '⚪',
    avatar: facts.avatar?.name ?? '',
    platform: facts.platform,
    platformEmoji: PLATFORM_EMOJI.find(([re]) => re.test(facts.platform))?.[1] ?? '❔',
    groupId: report.groupFilter,
    inGroup: groupFiltered ? facts.inGroup : undefined,
    inGroupText: groupFiltered ? yesNo(facts.inGroup, 'Unknown (only visible memberships count)') : undefined,
    inGroupEmoji: groupFiltered ? triState(facts.inGroup, '✅', '❌') : undefined,
    rejoin: seenHere,
    rejoinText: rejoinText(facts.rejoin),
    rejoinEmoji: triState(seenHere, '🔁', '🆕'),
    rejoinAgo: facts.rejoin.lastAt === undefined ? '' : timeAgo(facts.rejoin.lastAt),
    rejoinSince: facts.rejoin.lastAt === undefined ? '' : new Date(facts.rejoin.lastAt).toLocaleString(),
    rejoinAt: facts.rejoin.lastAt ?? '',
    world: instance.worldName,
    worldId: instance.worldId,
    instanceType: instance.instanceType,
    instanceId: instance.location.split('~')[0]?.split(':')[1] ?? '',
    location: instance.location,
    time: at.toLocaleTimeString(),
    date: at.toLocaleDateString(),
    timestamp: at.toISOString(),
  };
}

/**
 * The report through the user's template, one line per entry. An empty template means the
 * default; a template that does not parse falls back to it, with `onError` told why.
 */
export function reportLines(
  report: Report,
  template: string = DEFAULT_TEMPLATE,
  onError?: (error: TemplateError) => void,
): readonly string[] {
  const chosen = template.trim() === '' ? DEFAULT_TEMPLATE : template;
  const values = reportValues(report);
  try {
    return renderTemplate(chosen, values).split('\n');
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    onError?.(error);
    return renderTemplate(DEFAULT_TEMPLATE, values).split('\n');
  }
}

/** Everything a single-line surface can hold. */
export function reportSummary(report: Report): string {
  const { facts } = report;
  const bits = [
    `18+: ${yesNo(facts.ageVerified, '?')}`,
    `PC ${rank(facts.avatar?.pc ?? '').replace('Unknown', '?')}`,
    `Quest ${rank(facts.avatar?.quest ?? '').replace('Unknown', '?')}`,
  ];
  if (report.groupFilter !== '') bits.push(`group: ${yesNo(facts.inGroup, '?')}`);
  bits.push(report.facts.rejoin.seenHere === undefined ? 'rejoin ?' : (report.facts.rejoin.seenHere ? 'rejoin' : 'new'));
  return `${report.joiner.name} joined · ${bits.join(' · ')}`;
}

function accentFor(report: Report): 'ok' | 'warn' | 'info' {
  const { facts } = report;
  if (facts.ageVerified === false || facts.avatar?.pc === 'VeryPoor') return 'warn';
  if (facts.ageVerified === true) return 'ok';
  return 'info';
}

function warnTemplate(ctx: Ctx, error: TemplateError): void {
  ctx.logger.warn(`Report template is invalid, using the default: ${error.message}`);
}

/** Bridge targets: the VR overlay is the one whose name says so; the rest are desktop. */
function pickSinks(targets: readonly { readonly name: string }[], wantDesktop: boolean, wantVr: boolean): readonly string[] {
  return targets
    .filter((t) => {
      const vr = /wayvr|openvr|steamvr|overlay|xso/i.test(t.name);
      return vr ? wantVr : wantDesktop;
    })
    .map((t) => t.name);
}

/**
 * Through the bridge: `true` when at least one target accepted. `ok: false` with only the
 * `bridge` pseudo-sink failing means the bridge is not reachable, which is a normal state, not
 * an error; a target that refused is logged by name.
 */
async function sendNative(ctx: Ctx, wants: { readonly desktop: boolean; readonly vr: boolean }, report: Report): Promise<boolean> {
  let targets: readonly { readonly name: string }[];
  try {
    targets = await ctx.native.targets();
  } catch (error) {
    ctx.logger.debug(`Bridge targets not available: ${String(error)}`);
    return false;
  }
  const values = ctx.settings.values;
  const desktopSinks = wants.desktop ? pickSinks(targets, true, false) : [];
  const vrSinks = wants.vr ? pickSinks(targets, false, true) : [];
  if (desktopSinks.length === 0 && vrSinks.length === 0) {
    ctx.logger.debug('The bridge has no target for the enabled channels.');
    return false;
  }
  // VR overlays get their own template when one is set: WayVR draws with a single font and
  // shows nothing for emoji, so the rich format is often wrong there.
  const vrTemplate = values.templateVr.trim() === '' ? values.template : values.templateVr;
  const batches: { readonly sinks: readonly string[]; readonly template: string }[] =
    vrTemplate === values.template
      ? [{ sinks: [...desktopSinks, ...vrSinks], template: values.template }]
      : [{ sinks: desktopSinks, template: values.template }, { sinks: vrSinks, template: vrTemplate }];

  let delivered = false;
  for (const batch of batches.filter((b) => b.sinks.length > 0)) {
    const lines = reportLines(report, batch.template, (e) => { warnTemplate(ctx, e); });
    const result = await ctx.native.notify({
      title: lines[0] ?? `${report.joiner.name} joined`,
      content: lines.slice(1).join('\n'),
      timeoutSecs: values.notifyTimeoutSecs,
      icon: 'security-high',
      sinks: batch.sinks,
      // Never critical: KDE ignores the expiry for critical notifications and keeps them on screen.
      urgency: 'normal',
    });
    for (const failure of result.failed) {
      if (failure.sink !== 'bridge') ctx.logger.warn(`Bridge target ${failure.sink} failed: ${failure.error}`);
    }
    delivered ||= result.ok;
  }
  if (!delivered) ctx.logger.debug('Bridge not reachable or every target refused; falling back.');
  return delivered;
}

async function sendDesktopAndVr(ctx: Ctx, values: SettingsValues<Settings>, report: Report): Promise<void> {
  const wants = { desktop: values.notifyDesktop, vr: values.notifyVr };
  if (!wants.desktop && !wants.vr) return;
  if (await sendNative(ctx, wants, report)) return;

  // Windows without the bridge's targets: VRCNext's own tray toast and wrist overlay in one call.
  if (ctx.notifications.desktopAvailable) {
    const lines = reportLines(report, values.template, (e) => { warnTemplate(ctx, e); });
    ctx.notifications.desktop({
      title: lines[0] ?? `${report.joiner.name} joined`,
      subtitle: lines.slice(1).join(' · '),
      accent: accentFor(report),
      ...(report.joiner.userId === '' ? {} : { friendId: report.joiner.userId }),
    });
    return;
  }
  ctx.logger.info('No desktop or VR channel is reachable: the bridge delivered nothing and this platform has no tray toast.');
}

async function sendDiscord(ctx: Ctx, values: SettingsValues<Settings>, report: Report): Promise<void> {
  if (!values.notifyDiscord) return;
  const url = values.discordWebhookUrl.trim();
  if (!DISCORD_WEBHOOK.test(url)) {
    ctx.logger.warn('Discord webhook is enabled but the URL is not a discord.com webhook URL.');
    return;
  }
  const lines = reportLines(report, values.template, (e) => { warnTemplate(ctx, e); });
  const colour = { ok: 0x3ba55d, warn: 0xed4245, info: 0x5865f2 }[accentFor(report)];
  const body = {
    username: 'Club Security',
    embeds: [{
      title: lines[0],
      description: lines.slice(1).join('\n'),
      color: colour,
      footer: { text: `${report.instance.worldName} · ${report.instance.instanceType}` },
      timestamp: new Date(report.at).toISOString(),
    }],
    allowed_mentions: { parse: [] },
  };
  const response = await ctx.http.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) ctx.logger.warn(`Discord webhook answered ${String(response.status)}.`);
}

/** Sends on every enabled channel. Never throws: a failed channel is logged, not fatal. */
export async function notifyAll(ctx: Ctx, report: Report): Promise<void> {
  const values = ctx.settings.values;
  if (values.notifyToast) ctx.notifications.toast({ message: reportSummary(report), ok: accentFor(report) !== 'warn' });
  const results = await Promise.allSettled([
    sendDesktopAndVr(ctx, values, report),
    sendDiscord(ctx, values, report),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') ctx.logger.warn(`Notification channel failed: ${String(result.reason)}`);
  }
}
