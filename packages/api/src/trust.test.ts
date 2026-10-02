import { describe, expect, it } from 'vitest';

import { trustRankLabel, trustScore, trustScoreEmoji, yearsOnVrchat } from './trust.js';

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
