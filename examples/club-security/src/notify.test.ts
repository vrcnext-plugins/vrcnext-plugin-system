import assert from 'node:assert/strict';
import { test } from 'vitest';

import { reportLines, reportSummary, type Report } from './notify.js';

function report(overrides: Partial<Report> = {}): Report {
  return {
    at: 0,
    joiner: { name: 'Tupper', userId: 'usr_1' },
    instance: { location: 'wrld_a:1', worldId: 'wrld_a', worldName: 'Club', instanceType: 'group-public', groupId: 'grp_a', users: [] },
    facts: { ageVerified: true, ageStatus: '18+', platform: 'standalonewindows', avatar: { name: 'Ava', pc: 'Good', quest: 'Poor' }, inGroup: true, history: { metBefore: false, meetCount: 0, lastMet: undefined, matchingBefore: 0, windowSize: 0 } },
    groupFilter: 'grp_a',
    filtered: true,
    ...overrides,
  };
}

test('reportLines follows the specified layout', () => {
  assert.deepEqual(reportLines(report()), [
    'Player "Tupper" joined',
    '18+ Verified: Yes (18+)',
    'Avatar PC Performance Rank: Good',
    'Avatar Quest Performance Rank: Poor',
    'In Group: Yes',
    'Rejoin?: No (first time)',
  ]);
});

test('unknown facts are labelled rather than guessed, and the group line only appears with a filter', () => {
  const lines = reportLines(report({
    facts: { ageVerified: undefined, ageStatus: '', platform: '', avatar: undefined, inGroup: undefined, history: { metBefore: true, meetCount: 2, lastMet: { at: '2026-09-20T20:00:00Z', worldName: 'Club' }, matchingBefore: 1, windowSize: 3 } },
    groupFilter: '',
    filtered: false,
  }));
  assert.equal(lines[1], '18+ Verified: Unknown');
  assert.equal(lines[2], 'Avatar PC Performance Rank: Unknown');
  assert.equal(lines.some((l) => l.startsWith('In Group')), false);
  assert.match(lines[lines.length - 1] ?? '', /^Rejoin\?: Yes \(met 2× before; last .* in Club\)$/);
});

test('the matching-instance count only appears with a filter, and unknown history says so', () => {
  const filtered = reportLines(report({
    facts: { ...report().facts, history: { metBefore: true, meetCount: 4, lastMet: { at: '2026-09-20T20:00:00Z', worldName: 'Club' }, matchingBefore: 2, windowSize: 5 } },
  }));
  assert.match(filtered[filtered.length - 1] ?? '', /; 2 of the last 5 in matching instances\)$/);
  const unknown = reportLines(report({ facts: { ...report().facts, history: { metBefore: undefined, meetCount: 0, lastMet: undefined, matchingBefore: undefined, windowSize: 0 } } }));
  assert.equal(unknown[unknown.length - 1], 'Rejoin?: Unknown');
  assert.match(reportSummary(report({ facts: { ...report().facts, history: { metBefore: undefined, meetCount: 0, lastMet: undefined, matchingBefore: undefined, windowSize: 0 } } })), /history \?$/);
});

test('reportSummary fits one line', () => {
  assert.equal(reportSummary(report()), 'Tupper joined · 18+: Yes · PC Good · Quest Poor · group: Yes · new');
});
