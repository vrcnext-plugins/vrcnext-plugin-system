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
 * VRChat's language tags, as VRCNext labels them, plus the ones it has no name for.
 *
 * A profile's spoken languages are tags, not the `languages` array beside them — VRCNext sends
 * that array empty on every profile payload and renders the pills from the tags instead.
 *
 * The first block is VRCNext's own `LANG_MAP`, kept identical so a plugin and the app name a
 * language the same way. The second is everything VRChat has added since, which VRCNext renders
 * as a bare `ITA` or `HRV`; measured against a real profile store, twenty tags in active use
 * were unnamed, `zxx` and Italian among the most common. A tag in neither block still falls back
 * to its upper-cased code, so a language VRChat adds tomorrow degrades rather than disappears.
 *
 * One deliberate departure: VRCNext labels `dse` as `DGS`, but ISO 639-3 `dse` is **Dutch** Sign
 * Language and `DGS` is the German one, which is `gsg`. Copying that would caption a Dutch
 * signer as German, so the two are named correctly here and `gsg` is added.
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
  language_bfi: 'BSL', language_fsl: 'LSF', language_kvk: 'KSL',

  // Not in VRCNext's table. Spoken languages first, then the sign languages, then Toki Pona,
  // which is constructed and has no country to name it after.
  language_ita: 'Italiano', language_hrv: 'Hrvatski', language_ell: 'Ελληνικά',
  language_bul: 'Български', language_heb: 'עברית', language_hin: 'हिन्दी',
  language_ben: 'বাংলা', language_tel: 'తెలుగు', language_lav: 'Latviešu',
  language_lit: 'Lietuvių', language_ind: 'Bahasa Indonesia', language_ltz: 'Lëtzebuergesch',
  language_afr: 'Afrikaans', language_fil: 'Filipino', language_sco: 'Scots',
  language_cmn: '普通话', language_yue: '粵語', language_wuu: '吴语',
  language_dse: 'NGT', language_gsg: 'DGS', language_asf: 'Auslan',
  language_nzs: 'NZSL', language_tok: 'Toki Pona',
  // ISO 639-2 `zxx` is "no linguistic content", and 79 profiles in this owner's store carry it.
  // Named for what the standard says rather than guessed at — someone who set it may mean they
  // speak none, or sign only, or would rather not say, and the list is not the place to decide
  // which. `ZXX`, the code fallback, told a reader nothing at all.
  language_zxx: 'No language',
};

/** What one tag is called, falling back to the bare code for a tag VRChat added since. */
function labelFor(tag: string): string {
  return LANGUAGE_LABELS[tag] ?? tag.slice('language_'.length).toUpperCase();
}

/**
 * The order every list of languages here is in: alphabetical, by the label.
 *
 * A profile lists its languages in whatever order they were added, so the same two languages
 * come out in different orders on two profiles, and a caller showing flags in one place and
 * labels in another has no way to line them up. Sorted by the label and not by the tag, because
 * the label is what a reader sees: `日本語` belongs where its own text puts it, not where `jpn`
 * would.
 */
function byLabel(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * The languages a profile lists, read from its tags and named as VRCNext names them.
 *
 * Alphabetical, not in the profile's own order — see {@link byLabel}.
 */
export function languageLabels(tags: readonly string[] | undefined): readonly string[] {
  return languageTags(tags).map(labelFor).toSorted(byLabel);
}

/**
 * A flag emoji per language, mirroring VRCNext's own `LANG_FLAG` table.
 *
 * **These are countries, not languages**, and the pairing is VRCNext's: English is 🇺🇸 rather
 * than 🇬🇧, Portuguese 🇧🇷 rather than 🇵🇹, Chinese 🇨🇳 and Arabic 🇸🇦. Kept identical to the app
 * on purpose — a plugin that flagged English with 🇬🇧 beside VRCNext's own 🇺🇸 pill would look
 * like a bug — but it is a presentational convention, not a fact about a speaker.
 *
 * The five sign languages have no entry, because no country stands for one. {@link languageFlag}
 * answers `undefined` for them rather than picking a flag, and callers show the label instead.
 */
export const LANGUAGE_FLAGS: Readonly<Record<string, string>> = {
  language_eng: '🇺🇸', language_kor: '🇰🇷', language_rus: '🇷🇺',
  language_spa: '🇪🇸', language_por: '🇧🇷', language_zho: '🇨🇳',
  language_deu: '🇩🇪', language_jpn: '🇯🇵', language_fra: '🇫🇷',
  language_swe: '🇸🇪', language_nld: '🇳🇱', language_tur: '🇹🇷',
  language_ara: '🇸🇦', language_pol: '🇵🇱', language_dan: '🇩🇰',
  language_nor: '🇳🇴', language_fin: '🇫🇮', language_ces: '🇨🇿',
  language_hun: '🇭🇺', language_ron: '🇷🇴', language_tha: '🇹🇭',
  language_vie: '🇻🇳', language_ukr: '🇺🇦',

  // Beyond VRCNext's table, and only where one country is the obvious answer — Italian is 🇮🇹 the
  // way VRCNext's Polish is 🇵🇱. Deliberately absent: Bengali, Telugu, Cantonese, Wu and Scots,
  // whose speakers are not summed up by a national flag, and Toki Pona and `zxx`, which name no
  // place at all. They render as their label, which is the honest answer rather than a guess.
  language_ita: '🇮🇹', language_hrv: '🇭🇷', language_ell: '🇬🇷',
  language_bul: '🇧🇬', language_heb: '🇮🇱', language_hin: '🇮🇳',
  language_lav: '🇱🇻', language_lit: '🇱🇹', language_ind: '🇮🇩',
  language_ltz: '🇱🇺', language_afr: '🇿🇦', language_fil: '🇵🇭',
  language_cmn: '🇨🇳',
};

/** One language, as a label and the flag that goes with it where there is one. */
export interface SpokenLanguage {
  /** The tag itself, `language_deu`, for a caller that wants to map it some other way. */
  readonly tag: string;
  /** `Deutsch`, in its own script, or the upper-cased code for a tag VRChat added since. */
  readonly label: string;
  /** `undefined` for the sign languages, and for any tag with no flag of its own. */
  readonly flag?: string;
}

/** Every `language_*` tag, in the order the profile lists them. */
function languageTags(tags: readonly string[] | undefined): readonly string[] {
  return (tags ?? []).filter((tag) => tag.startsWith('language_'));
}

/**
 * The flag for one language tag, or `undefined` when none stands for it.
 *
 * Deliberately not falling back to a flag-shaped placeholder: a wrong flag beside someone's name
 * says something about them that is not true, and an absent one says nothing.
 */
export function languageFlag(tag: string): string | undefined {
  return LANGUAGE_FLAGS[tag];
}

/**
 * The languages a profile lists, each with its label and its flag.
 *
 * The pairing a caller usually wants: a list of flags for a compact line, and the labels to go
 * beside them in a longer one, both from the same source and in the same order — alphabetical
 * by label, as {@link byLabel} explains, so a row of flags and a list of names agree.
 */
export function spokenLanguages(tags: readonly string[] | undefined): readonly SpokenLanguage[] {
  return languageTags(tags)
    .map((tag) => {
      const flag = languageFlag(tag);
      const label = labelFor(tag);
      return flag === undefined ? { tag, label } : { tag, label, flag };
    })
    .toSorted((a, b) => byLabel(a.label, b.label));
}

/**
 * Just the flags, in profile order — `🇩🇪 🇺🇸` for a German who also speaks English.
 *
 * Languages without a flag are left out rather than spaced over, so the result is either a run
 * of flags or empty, and a caller can treat empty as "nothing to prefix".
 */
export function languageFlags(tags: readonly string[] | undefined): readonly string[] {
  return spokenLanguages(tags).flatMap((language) => (language.flag === undefined ? [] : [language.flag]));
}
