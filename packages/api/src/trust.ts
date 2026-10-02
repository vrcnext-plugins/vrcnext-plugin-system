/**
 * A trust score out of everything VRChat says about a person, as VRCNext used to show it.
 *
 * VRCNext carried a "Trust Score" bar on every profile until it was dropped in a refactor
 * (`dac081f4`, 2026-09-24). The weights and criteria here are that implementation's, so a
 * plugin's number and the one people remember from the profile agree.
 *
 * A criterion whose data the caller does not have is left out of the total rather than scored
 * zero: not knowing how many badges someone has is not evidence against them.
 */

import { trustRank } from './vrchat.js';

/** Everything the score can read. Every field is optional; what is absent is not counted. */
export interface TrustInput {
  readonly tags?: readonly string[];
  /** VRChat's `dateJoined`, either `YYYY-MM-DD` or a full ISO timestamp. */
  readonly dateJoined?: string;
  readonly ageVerified?: boolean;
  /** `18+`, `verified`, `hidden` or `''`. */
  readonly ageVerificationStatus?: string;
  readonly bio?: string;
  readonly badgeCount?: number;
  /** Groups the person shows publicly. */
  readonly groupCount?: number;
  /** Whether they are representing one of them. */
  readonly representingGroup?: boolean;
  /** Worlds and avatars they have uploaded, added together. */
  readonly contentCount?: number;
}

export interface TrustCriterion {
  readonly key: 'rank' | 'age' | 'years' | 'supporter' | 'badges' | 'bio' | 'content' | 'groups';
  readonly label: string;
  /** `0`–`1`. */
  readonly score: number;
  /** How much of the total it is worth. */
  readonly weight: number;
  /** The reading behind the score, where there is one worth showing. */
  readonly detail?: string;
}

export interface TrustScore {
  /** `0`–`100`, rounded. */
  readonly percent: number;
  /** Only the criteria that could be read. */
  readonly criteria: readonly TrustCriterion[];
  /** A sentence about the standing, as the profile bar phrased it. */
  readonly description: string;
}

const RANK_MAX = 4;
const BADGE_TARGET = 4;
const YEAR_TARGET = 3;
const YEAR_WEIGHT = 3;
const GROUP_TARGET = 20;
const GROUP_JOIN_WEIGHT = 0.8;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** VRChat's ladder as a level, `0` (visitor) to `4` (legend/veteran). */
export function trustRankLevel(tags: readonly string[]): number {
  if (tags.includes('system_trust_legend') || tags.includes('system_trust_veteran')) return 4;
  if (tags.includes('system_trust_trusted')) return 3;
  if (tags.includes('system_trust_known')) return 2;
  if (tags.includes('system_trust_basic')) return 1;
  return 0;
}

/**
 * VRChat's ladder as the name VRCNext shows: Visitor, New User, User, Known User, Trusted User.
 *
 * The tag names are offset by one from the labels — `system_trust_trusted` is shown as "Known
 * User" and it takes `system_trust_veteran` to be called "Trusted User". That is VRChat's own
 * quirk, and VRCNext displays it that way, so this mirrors it rather than correcting it: a
 * report that disagreed with the app about someone's rank would be read as the report being
 * wrong.
 */
export function trustRankLabel(tags: readonly string[]): string {
  return TRUST_RANK_LABELS[trustRankLevel(tags)] ?? 'Visitor';
}

const TRUST_RANK_LABELS: readonly string[] = ['Visitor', 'New User', 'User', 'Known User', 'Trusted User'];

/** Years on VRChat, or `undefined` when the join date is unreadable. */
export function yearsOnVrchat(dateJoined: string | undefined, now = Date.now()): number | undefined {
  if (dateJoined === undefined || dateJoined === '') return undefined;
  const at = Date.parse(dateJoined.length === 10 ? `${dateJoined}T00:00:00` : dateJoined);
  if (!Number.isFinite(at)) return undefined;
  return Math.max((now - at) / YEAR_MS, 0);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function describe(percent: number): string {
  if (percent >= 100) return 'This user has a trusted user standing within the community.';
  if (percent >= 80) return 'This user has a highly trusted standing within the community.';
  if (percent >= 60) return 'This user has a good standing within the community.';
  if (percent >= 40) return 'This user has some established trust within the community.';
  if (percent >= 20) return 'This user has a low level of established trust within the community.';
  return 'This user has no established trust within the community yet.';
}

/** The dot that goes in front of a percentage: green, yellow, orange, red. */
export function trustScoreEmoji(percent: number): string {
  if (percent >= 90) return '🟢';
  if (percent >= 70) return '🟡';
  if (percent >= 40) return '🟠';
  return '🔴';
}

export function trustScore(user: TrustInput, now = Date.now()): TrustScore {
  const criteria: TrustCriterion[] = [];
  const tags = user.tags;

  if (tags !== undefined) {
    const level = trustRankLevel(tags);
    criteria.push({
      key: 'rank', label: 'Trusted User', weight: 1,
      score: level / RANK_MAX, detail: trustRank(tags).label,
    });
    criteria.push({
      key: 'supporter', label: 'VRC+ Supporter', weight: 1,
      score: tags.includes('system_supporter') ? 1 : 0,
    });
  }

  const verified = user.ageVerified === true || user.ageVerificationStatus === '18+';
  // `hidden` says nothing either way, so it is not scored at all.
  if (user.ageVerified !== undefined || (user.ageVerificationStatus ?? '') !== '') {
    if (verified || user.ageVerificationStatus !== 'hidden') {
      criteria.push({ key: 'age', label: 'Age Verified', weight: 1, score: verified ? 1 : 0 });
    }
  }

  const years = yearsOnVrchat(user.dateJoined, now);
  if (years !== undefined) {
    criteria.push({
      key: 'years', label: `${String(YEAR_TARGET)}+ years on VRChat`, weight: YEAR_WEIGHT,
      score: clamp01(years / YEAR_TARGET),
      detail: `${String(Math.min(Math.floor(years), YEAR_TARGET))} / ${String(YEAR_TARGET)}`,
    });
  }

  if (user.badgeCount !== undefined) {
    criteria.push({
      key: 'badges', label: `${String(BADGE_TARGET)}+ badges`, weight: 1,
      score: clamp01(user.badgeCount / BADGE_TARGET),
      detail: `${String(Math.min(user.badgeCount, BADGE_TARGET))} / ${String(BADGE_TARGET)}`,
    });
  }

  if (user.bio !== undefined) {
    criteria.push({ key: 'bio', label: 'Has a bio', weight: 1, score: user.bio.trim() === '' ? 0 : 1 });
  }

  if (user.contentCount !== undefined) {
    criteria.push({ key: 'content', label: 'Uploaded content', weight: 1, score: user.contentCount >= 1 ? 1 : 0 });
  }

  if (user.groupCount !== undefined) {
    criteria.push({
      key: 'groups', label: 'Joined a few groups', weight: 1,
      score: clamp01(user.groupCount / GROUP_TARGET) * GROUP_JOIN_WEIGHT
        + (user.representingGroup === true ? 1 - GROUP_JOIN_WEIGHT : 0),
    });
  }

  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  const earned = criteria.reduce((sum, c) => sum + c.score * c.weight, 0);
  const percent = total === 0 ? 0 : Math.round((earned / total) * 100);
  return { percent, criteria, description: describe(percent) };
}

/**
 * VRChat's language tags, as VRCNext labels them.
 *
 * A profile's spoken languages are tags, not the `languages` array beside them — VRCNext sends
 * that array empty on every profile payload and renders the pills from the tags instead.
 */
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  language_eng: 'English', language_kor: '한국어', language_rus: 'Русский',
  language_spa: 'Español', language_por: 'Português', language_zho: '中文',
  language_deu: 'Deutsch', language_jpn: '日本語', language_fra: 'Français',
  language_swe: 'Svenska', language_nld: 'Nederlands', language_tur: 'Türkçe',
  language_ara: 'العربية', language_pol: 'Polski', language_dan: 'Dansk',
  language_nor: 'Norsk', language_fin: 'Suomi', language_ces: 'Čeština',
  language_hun: 'Magyar', language_ron: 'Română', language_tha: 'ไทย',
  language_vie: 'Tiếng Việt', language_ukr: 'Українська', language_ase: 'ASL',
  language_bfi: 'BSL', language_dse: 'DGS', language_fsl: 'LSF',
  language_kvk: 'KSL',
};

/** The languages a profile lists, read from its tags and named as VRCNext names them. */
export function languageLabels(tags: readonly string[] | undefined): readonly string[] {
  if (tags === undefined) return [];
  return tags
    .filter((tag) => tag.startsWith('language_'))
    .map((tag) => LANGUAGE_LABELS[tag] ?? tag.slice('language_'.length).toUpperCase());
}
