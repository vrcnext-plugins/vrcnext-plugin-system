import assert from 'node:assert/strict';
import { test } from 'vitest';

import { reportLines, reportSummary, type Report } from './notify.js';

function report(overrides: Partial<Report> = {}): Report {
  return {
    at: 0,
    joiner: { name: 'Tupper', userId: 'usr_1' },
    instance: { location: 'wrld_a:1', worldId: 'wrld_a', worldName: 'Club', instanceType: 'group-public', groupId: 'grp_a', users: [] },
    facts: { ageVerified: true, ageStatus: '18+', platform: 'standalonewindows', avatar: { name: 'Ava', pc: 'Good', quest: 'Poor' }, inGroup: true },
    groupFilter: 'grp_a',
    previous: undefined,
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
    facts: { ageVerified: undefined, ageStatus: '', platform: '', avatar: undefined, inGroup: undefined },
    groupFilter: '',
    previous: { name: 'Tupper', joins: 2, firstSeen: 0, lastSeen: 0, lastLocation: 'wrld_a:1' },
  }));
  assert.equal(lines[1], '18+ Verified: Unknown');
  assert.equal(lines[2], 'Avatar PC Performance Rank: Unknown');
  assert.equal(lines.some((l) => l.startsWith('In Group')), false);
  assert.match(lines[lines.length - 1] ?? '', /^Rejoin\?: Yes \(2× before, last /);
});

test('reportSummary fits one line', () => {
  assert.equal(reportSummary(report()), 'Tupper joined · 18+: Yes · PC Good · Quest Poor · group: Yes · new');
});
