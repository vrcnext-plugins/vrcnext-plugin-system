/**
 * Source size limits.
 *
 * ESLint's `max-lines` / `max-lines-per-function` already fail the build at the hard limits, but
 * a rule can only carry one threshold. This test adds the *soft* limit: it names files that are
 * approaching the hard cap so the seam gets found while splitting is still cheap, and it
 * double-covers file length for anything the linter does not reach.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const HARD_FILE_LINES = 1000;
const SOFT_FILE_LINES = 600;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCANNED = ['packages', 'examples'];
const SKIPPED = new Set(['node_modules', 'dist']);

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(path);
    }
  }
  return found;
}

test('no source file exceeds the hard line limit', async () => {
  const over: string[] = [];
  const approaching: string[] = [];

  for (const root of SCANNED) {
    for (const path of await sourceFiles(join(ROOT, root))) {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      const name = relative(ROOT, path);
      if (lines > HARD_FILE_LINES) {
        over.push(`${name} — ${String(lines)} lines (limit ${String(HARD_FILE_LINES)})`);
      } else if (lines > SOFT_FILE_LINES) {
        approaching.push(`${name} — ${String(lines)} lines`);
      }
    }
  }

  // Not a failure: surfaces the seam while splitting is still cheap.
  for (const note of approaching) {
    globalThis.console.warn(`note: ${note}, approaching the ${String(HARD_FILE_LINES)}-line limit`);
  }

  assert.deepEqual(over, [], `files over the size limit:\n${over.join('\n')}`);
});
