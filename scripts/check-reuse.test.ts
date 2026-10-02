/**
 * The reuse check against written-out cases.
 *
 * Each case is a file the checker reads from a temporary directory, so the test exercises the
 * script exactly as the gate runs it, including the `--json` output the gate does not use.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly id: string;
}

/** Runs the checker over one file's source and returns what it found. */
function check(source: string, name = 'subject.ts'): readonly Finding[] {
  const dir = mkdtempSync(join(tmpdir(), 'reuse-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', name), source);
  try {
    const out = execFileSync('node', [join(import.meta.dirname, 'check-reuse.mjs'), '--json', dir], {
      encoding: 'utf8',
    });
    return JSON.parse(out) as readonly Finding[];
  } catch (error) {
    // Exit status 1 means findings, which is the normal case here.
    const out = (error as { stdout?: string }).stdout ?? '[]';
    return JSON.parse(out) as readonly Finding[];
  }
}

test('a raw request must say why the mirrored and cached paths would not do', () => {
  assert.deepEqual(check('await channel.request({ action: "x", expect: "y" });').map((f) => f.id), ['request']);
  assert.deepEqual(
    check('// reuse: there is no push for this; VRCNext only answers when asked.\nawait channel.request({ action: "x" });'),
    [],
    'a reason on the line above is the marker',
  );
  assert.deepEqual(check('await channel.request({ action: "x" }); // reuse: nothing holds it'), [],
    'and so is a trailing one');
});

test('the wrappers that already reuse are not themselves flagged', () => {
  assert.deepEqual(check('return this.#list(this.#friends, { action: "x", expect: "y" }, options);'), [],
    '#list reads the push and then the page before it asks');
  assert.deepEqual(check('return this.#detail(`user:${id}`, { action: "x", expect: "y" }, options);'), [],
    '#detail holds the answer');
});

test('a forced-fresh read and an outbound request are costs too', () => {
  assert.deepEqual(check('await vrchat.user(id, { cached: false });').map((f) => f.id), ['fresh']);
  assert.deepEqual(check('await ctx.http.fetch(url);').map((f) => f.id), ['http']);
});

test('a mirror is answered by having a page fallback, not by a marker', () => {
  assert.deepEqual(check('readonly #friends = new Mirror<string[]>(read, pageLists.friends);'), [],
    'the fallback is the answer');
  assert.deepEqual(check('readonly #friends = new Mirror<string[]>(read);').map((f) => f.id), ['mirror']);
  assert.deepEqual(
    check('// reuse: no page state — VRCNext renders this straight from the push.\nreadonly #x = new Mirror<string[]>(read);'),
    [],
    'the one honest reason a mirror is the only copy',
  );
  assert.deepEqual(
    check('// reuse: felt right\nreadonly #x = new Mirror<string[]>(read);').map((f) => f.id),
    ['mirror'],
    'any other reason does not excuse a mirror VRCNext could have seeded',
  );
});

test('a multi-line fallback still counts, because the reader is what matters', () => {
  const source = [
    'readonly #friends = new Mirror<readonly string[]>((p) => {',
    '  return Array.isArray(p) ? p : undefined;',
    '}, pageLists.friends);',
  ].join('\n');
  assert.deepEqual(check(source), []);
});

test('held VRChat state is a cost; a working value inside a function is not', () => {
  assert.deepEqual(check('  readonly #worlds = new Map<string, string>();').map((f) => f.id), ['state']);
  assert.deepEqual(check('function f() {\n  const worlds = new Map<string, string>();\n}'), [],
    'a local is a working value, not a second copy of VRCNext\'s data');
  assert.deepEqual(check('  readonly #blocks = new Set<HTMLElement>();'), [],
    'a set of DOM blocks is not a set of blocked users');
  assert.deepEqual(check('  readonly #timers = new Map<string, number>();'), [],
    'nothing about VRChat data, so not this check\'s business');
});

test('test files are skipped, because a fake names things on purpose', () => {
  assert.deepEqual(check('await channel.request({ action: "x" });', 'subject.test.ts'), []);
});
