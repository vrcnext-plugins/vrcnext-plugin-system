import assert from 'node:assert/strict';
import { test } from 'vitest';

import { reportLines, reportSummary, type Report } from './notify.js';
import { migrateTemplate } from './settings.js';

function report(overrides: Partial<Report> = {}): Report {
  return {
    at: 0,
    joiner: { name: 'Tupper', userId: 'usr_1' },
    instance: { location: 'wrld_a:1', worldId: 'wrld_a', worldName: 'Club', instanceType: 'group-public', groupId: 'grp_a', users: [] },
    facts: { ageVerified: true, ageStatus: '18+', platform: 'standalonewindows', avatar: { name: 'Ava', pc: 'Good', quest: 'Poor' }, inGroup: true, rejoin: { seenHere: false, lastAt: undefined } },
    groupFilter: 'grp_a',
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
    'Rejoin?: No',
  ]);
});

test('unknown facts are labelled rather than guessed, and the group line only appears with a filter', () => {
  const lines = reportLines(report({
    facts: { ageVerified: undefined, ageStatus: '', platform: '', avatar: undefined, inGroup: undefined, rejoin: { seenHere: true, lastAt: new Date(Date.now() - 3 * 3_600_000).toISOString() } },
    groupFilter: '',
  }));
  assert.equal(lines[1], '18+ Verified: Unknown');
  assert.equal(lines[2], 'Avatar PC Performance Rank: Unknown');
  assert.equal(lines.some((l) => l.startsWith('In Group')), false);
  assert.equal(lines[lines.length - 1], 'Rejoin?: Yes (3 hours ago)');
});

test('unknown rejoin is labelled, not guessed', () => {
  const unknown = reportLines(report({ facts: { ...report().facts, rejoin: { seenHere: undefined, lastAt: undefined } } }));
  assert.equal(unknown[unknown.length - 1], 'Rejoin?: Unknown');
  assert.match(reportSummary(report({ facts: { ...report().facts, rejoin: { seenHere: undefined, lastAt: undefined } } })), /rejoin \?$/);
  assert.equal(reportLines(report())[5], 'Rejoin?: No');
});

test('a custom template picks its own facts and drops lines with nothing in them', () => {
  const lines = reportLines(report({ facts: { ...report().facts, avatar: undefined } }), '{name} ({platform})\nAvatar: {avatar}\n{rejoinText} · {world}');
  assert.deepEqual(lines, ['Tupper (standalonewindows)', 'No · Club']);
  assert.deepEqual(reportLines(report(), '   ')[0], 'Player "Tupper" joined', 'blank template means the default');
});

test('expressions, booleans and emoji variables are available to templates', () => {
  const lines = reportLines(
    report(),
    '{{ "REJOIN" if rejoin else "new" }} {{ ageVerified | yesno("18+", "minor?") }} {pcRankEmoji}{questRankEmoji} {platformEmoji} {{ inGroup ? "member" : "outsider" }}\n{% if pcRank == "VeryPoor" %}heavy{% else %}fine{% endif %}',
  );
  assert.deepEqual(lines, ['new 18+ 🔵🟠 🖥️ member', 'fine']);
});

test('a template that does not parse falls back to the default and reports why', () => {
  const errors: string[] = [];
  const lines = reportLines(report(), '{{ name', (e) => { errors.push(e.message); });
  assert.equal(lines[0], 'Player "Tupper" joined');
  assert.equal(errors.length, 1);
});

test('migrateTemplate renames the first version’s shorthand variables and nothing else', () => {
  assert.equal(migrateTemplate('A: {ageVerified} {pcRank} {{ rejoin }} {name}'), 'A: {ageVerifiedText} {pcRankText} {{ rejoin }} {name}');
  assert.equal(migrateTemplate('{rejoinText}'), '{rejoinText}');
});

test('reportSummary fits one line', () => {
  assert.equal(reportSummary(report()), 'Tupper joined · 18+: Yes · PC Good · Quest Poor · group: Yes · new');
});
