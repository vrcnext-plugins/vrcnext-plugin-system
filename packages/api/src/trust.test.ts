import { describe, expect, it } from 'vitest';

import { languageFlag, languageFlags, languageLabels, spokenLanguages, trustRankLabel, trustScore, trustScoreEmoji, yearsOnVrchat } from './trust.js';

const NOW = Date.parse('2026-09-27T00:00:00Z');

describe('yearsOnVrchat', () => {
  it('reads both spellings VRChat uses', () => {
    expect(yearsOnVrchat('2023-09-27', NOW)).toBeCloseTo(3, 1);
    expect(yearsOnVrchat('2023-09-27T12:00:00.000Z', NOW)).toBeCloseTo(3, 1);
  });

  it('is unknown rather than zero when there is no date', () => {
    expect(yearsOnVrchat(undefined, NOW)).toBeUndefined();
    expect(yearsOnVrchat('', NOW)).toBeUndefined();
    expect(yearsOnVrchat('whenever', NOW)).toBeUndefined();
  });
});

describe('trustScore', () => {
  it('gives everything to someone who meets every criterion', () => {
    const score = trustScore({
      tags: ['system_trust_legend', 'system_supporter'],
      dateJoined: '2018-01-01',
      ageVerificationStatus: '18+',
      bio: 'hello',
      badgeCount: 9,
      groupCount: 30,
      representingGroup: true,
      contentCount: 2,
    }, NOW);
    expect(score.percent).toBe(100);
    expect(score.description).toMatch(/trusted user standing/);
  });

  it('gives nothing to a brand new account', () => {
    const score = trustScore({
      tags: [], dateJoined: '2026-09-26', ageVerificationStatus: '',
      bio: '', badgeCount: 0, groupCount: 0, contentCount: 0,
    }, NOW);
    expect(score.percent).toBe(0);
  });

  it('leaves out what it was not told rather than scoring it zero', () => {
    const known = trustScore({ tags: ['system_trust_legend'], bio: 'hi' }, NOW);
    expect(known.criteria.map((c) => c.key)).toEqual(['rank', 'supporter', 'bio']);
    // Rank full, supporter empty, bio full: two of three.
    expect(known.percent).toBe(67);
  });

  it('does not count a hidden age status against anyone', () => {
    const hidden = trustScore({ ageVerificationStatus: 'hidden' }, NOW);
    expect(hidden.criteria).toEqual([]);
    expect(trustScore({ ageVerificationStatus: 'verified' }, NOW).criteria).toHaveLength(1);
  });

  it('weights the years heaviest, as the profile bar did', () => {
    const young = trustScore({ tags: ['system_trust_legend'], dateJoined: '2026-09-01' }, NOW);
    // Rank and supporter are 1 + 1, the years 3: a full rank alone cannot carry it, and the
    // few weeks since they joined are worth the odd percent on top.
    expect(young.percent).toBe(21);
  });
});

describe('trustScoreEmoji', () => {
  it('colours the number the way the bar did', () => {
    expect(trustScoreEmoji(100)).toBe('🟢');
    expect(trustScoreEmoji(80)).toBe('🟡');
    expect(trustScoreEmoji(50)).toBe('🟠');
    expect(trustScoreEmoji(10)).toBe('🔴');
  });
});

it("labels the rank with VRChat's off-by-one naming, as the app shows it", () => {
  // `system_trust_trusted` is displayed as "Known User": the tags are one rung below the
  // labels, VRCNext shows it that way, and a report that disagreed would read as the wrong one.
  expect(trustRankLabel(['system_trust_veteran'])).toBe('Trusted User');
  expect(trustRankLabel(['system_trust_legend'])).toBe('Trusted User');
  expect(trustRankLabel(['system_trust_trusted'])).toBe('Known User');
  expect(trustRankLabel(['system_trust_known'])).toBe('User');
  expect(trustRankLabel(['system_trust_basic'])).toBe('New User');
  expect(trustRankLabel([])).toBe('Visitor');
});

it('pairs each language with its flag, and leaves sign languages unflagged', () => {
  const tags = ['system_trust_known', 'language_deu', 'language_eng', 'language_ase'];
  expect(languageLabels(tags)).toEqual(['ASL', 'Deutsch', 'English']);
  expect(languageFlags(tags)).toEqual(['🇩🇪', '🇺🇸']);
  expect(spokenLanguages(tags)).toEqual([
    // No country stands for a sign language, and a wrong flag beside a name is worse than none.
    { tag: 'language_ase', label: 'ASL' },
    { tag: 'language_deu', label: 'Deutsch', flag: '🇩🇪' },
    { tag: 'language_eng', label: 'English', flag: '🇺🇸' },
  ]);
});

it('sorts by label whatever order the profile lists its tags in', () => {
  // The same two languages in either order, so a row of flags and a list of names line up and
  // two profiles that speak the same pair read the same way.
  const one = ['language_eng', 'language_deu'];
  const other = ['language_deu', 'language_eng'];
  expect(languageLabels(one)).toEqual(languageLabels(other));
  expect(languageFlags(one)).toEqual(['🇩🇪', '🇺🇸']);
  expect(languageFlags(other)).toEqual(['🇩🇪', '🇺🇸']);

  // By the label and not by the tag: `日本語` sorts by its own text, where `jpn` would have put
  // it between Italiano and Lietuvių.
  expect(languageLabels(['language_jpn', 'language_ita', 'language_lit']))
    .toEqual(['Italiano', 'Lietuvių', '日本語']);
});

it('a language tag VRChat added since is kept, named by its code, and unflagged', () => {
  expect(spokenLanguages(['language_xyz'])).toEqual([{ tag: 'language_xyz', label: 'XYZ' }]);
  expect(languageFlags(['language_xyz'])).toEqual([]);
});

it('no tags, and no language tags, are both simply nothing', () => {
  expect(spokenLanguages(undefined)).toEqual([]);
  expect(languageFlags(['system_trust_known'])).toEqual([]);
  expect(languageFlag('language_deu')).toBe('🇩🇪');
  expect(languageFlag('language_bfi')).toBeUndefined();
});

it('names the languages VRCNext has no name for, and signs them correctly', () => {
  // VRCNext renders these as `ITA` and `HRV`; a real profile store had twenty such tags in use.
  expect(spokenLanguages(['language_ita', 'language_hrv'])).toEqual([
    { tag: 'language_hrv', label: 'Hrvatski', flag: '🇭🇷' },
    { tag: 'language_ita', label: 'Italiano', flag: '🇮🇹' },
  ]);

  // ISO 639-3: `dse` is Dutch Sign Language, `gsg` the German one. VRCNext calls `dse` "DGS",
  // which captions a Dutch signer as German.
  // Named per tag rather than per position, because the list is sorted by label: `['DGS', 'NGT']`
  // would read as if `dse` were the German one, which is the mistake being tested for.
  expect(spokenLanguages(['language_dse', 'language_gsg'])).toEqual([
    { tag: 'language_gsg', label: 'DGS' },
    { tag: 'language_dse', label: 'NGT' },
  ]);

  // No flag where no country stands for the language, rather than a plausible-looking guess.
  expect(languageFlags(['language_yue', 'language_sco', 'language_tok', 'language_zxx'])).toEqual([]);
  // `zxx` is the standard's "no linguistic content", so it is named rather than left as `ZXX`.
  expect(languageLabels(['language_zxx'])).toEqual(['No language']);
  expect(languageLabels(['language_yue', 'language_tok'])).toEqual(['Toki Pona', '粵語']);
});
