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

import type { PluginContext, SettingsValues } from '@vrcnext/plugin-api';

import type { Facts, Joiner } from './collector.js';
import type { SeenEntry } from './memory.js';
import type { Settings } from './settings.js';
import type { CurrentInstance } from './vrcnext-data.js';

export interface Report {
  readonly at: number;
  readonly joiner: Joiner;
  readonly instance: CurrentInstance;
  readonly facts: Facts;
  /** Whether a group filter was active, so the "In Group" line is only shown when it means something. */
  readonly groupFilter: string;
  readonly previous: SeenEntry | undefined;
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

function rejoinText(previous: SeenEntry | undefined): string {
  if (previous === undefined) return 'No (first time)';
  const when = new Date(previous.lastSeen).toLocaleString();
  return `Yes (${String(previous.joins)}× before, last ${when})`;
}

/** The report as the spec lays it out, one fact per line. */
export function reportLines(report: Report): readonly string[] {
  const { facts } = report;
  const age = facts.ageVerified === undefined
    ? 'Unknown'
    : `${yesNo(facts.ageVerified)}${facts.ageStatus === '' ? '' : ` (${facts.ageStatus})`}`;
  const lines = [
    `Player "${report.joiner.name}" joined`,
    `18+ Verified: ${age}`,
    `Avatar PC Performance Rank: ${rank(facts.avatar?.pc ?? '')}`,
    `Avatar Quest Performance Rank: ${rank(facts.avatar?.quest ?? '')}`,
  ];
  if (report.groupFilter !== '') lines.push(`In Group: ${yesNo(facts.inGroup, 'Unknown (only visible memberships count)')}`);
  lines.push(`Rejoin?: ${rejoinText(report.previous)}`);
  return lines;
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
  bits.push(report.previous === undefined ? 'new' : 'rejoin');
  return `${report.joiner.name} joined · ${bits.join(' · ')}`;
}

function accentFor(report: Report): 'ok' | 'warn' | 'info' {
  const { facts } = report;
  if (facts.ageVerified === false || facts.avatar?.pc === 'VeryPoor') return 'warn';
  if (facts.ageVerified === true) return 'ok';
  return 'info';
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
  const sinks = pickSinks(targets, wants.desktop, wants.vr);
  if (sinks.length === 0) {
    ctx.logger.debug('The bridge has no target for the enabled channels.');
    return false;
  }
  const lines = reportLines(report).slice(1);
  const result = await ctx.native.notify({
    title: `${report.joiner.name} joined`,
    content: lines.join('\n'),
    timeoutSecs: 8,
    icon: 'security-high',
    sinks,
    urgency: accentFor(report) === 'warn' ? 'critical' : 'normal',
  });
  for (const failure of result.failed) {
    if (failure.sink !== 'bridge') ctx.logger.warn(`Bridge target ${failure.sink} failed: ${failure.error}`);
  }
  if (!result.ok) ctx.logger.debug('Bridge not reachable or every target refused; falling back.');
  return result.ok;
}

async function sendDesktopAndVr(ctx: Ctx, values: SettingsValues<Settings>, report: Report): Promise<void> {
  const wants = { desktop: values.notifyDesktop, vr: values.notifyVr };
  if (!wants.desktop && !wants.vr) return;
  if (await sendNative(ctx, wants, report)) return;

  // Windows without the bridge's targets: VRCNext's own tray toast and wrist overlay in one call.
  if (ctx.notifications.desktopAvailable) {
    ctx.notifications.desktop({
      title: `${report.joiner.name} joined`,
      subtitle: reportLines(report).slice(1).join(' · '),
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
  const lines = reportLines(report);
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
