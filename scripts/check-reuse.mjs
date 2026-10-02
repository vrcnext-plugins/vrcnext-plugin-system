#!/usr/bin/env node
// Ask, at every point that costs something, whether VRCNext already has the answer.
//
//   node scripts/check-reuse.mjs [--json] <dir>...
//
// Two things in this codebase are worth a second thought before they are written:
//
//   * **Making VRCNext work.** A quiet request, a detail or list lookup, a forced-fresh read, or
//     an outbound HTTP call. Each one costs a VRChat API request — sometimes five, as
//     `vrcGetAllModerations` did — and VRChat rate-limits the account, not the plugin.
//   * **Holding VRChat data in memory.** A `Map`, a `Set` or a `Mirror` that remembers something
//     about users, worlds, avatars, groups, instances or moderation. A second copy of what the
//     page is already maintaining is both wasted and staler than the original.
//
// Neither is wrong. Both are *often* unnecessary, because VRCNext has usually already fetched
// the thing and is holding it in the page — `vrcFriendsData` had 1282 friends in it while
// `friends()` was asking for them again, and `blockedData` had 302 entries while
// `moderationCounts()` spent five uncached HTTP calls counting them.
//
// So each site must say which it is, on its own line or the line above:
//
//   reuse: <why nothing existing answers this>
//
// Write the reason, not the word. "reuse: needed" is worse than no marker, because the next
// reader believes it. Before adding one, check:
//
//   * `packages/host/src/capabilities/vrchat/page-state.ts` — what VRCNext holds in the page.
//   * `ctx.vrchat.name(kind, id)` — a world, avatar or group name, already resolved, free.
//   * `ctx.vrchat.self()`, `moderations()`, `moderationCounts()` — reads, not lookups.
//   * The `Mirror` fields — a list VRCNext pushes is mirrored, so asking is only ever a cold start.
//   * In the running app: `vrcnext-eval 'return typeof someGlobal'` answers it in one line.
//
// A `Mirror` built without a page fallback is always reported, marker or not, unless the marker
// is `reuse: no page state` — VRCNext holding a list and the host not reading it is the exact
// bug this check exists for.
//
// Exit status 1 if any site is unmarked.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIPPED = new Set(['node_modules', 'dist', '.git', 'coverage', 'protocol']);
const MARKER = /\breuse:\s*(?<reason>\S.*?)\s*$/;
/** A `//` comment line, which is where a marker may sit above the thing it explains. */
const COMMENT = /^\s*(?:\/\/|\*)/;

/** What each pattern is, in words a reader can act on. */
const PATTERNS = [
  {
    id: 'request',
    /*
     * A raw request to VRCNext.
     *
     * `#list` and `#detail` are deliberately not here: they are the reuse-aware path — `#list`
     * reads the push and then the page before it asks, `#detail` holds the answer — and each
     * carries the reason once, where it is defined. The thing worth questioning is a request
     * that goes around them.
     */
    test: /\bchannel\.(?:request|gather)\s*\(/,
    says: 'asks VRCNext to fetch something, outside the mirrored and cached paths',
  },
  {
    id: 'fresh',
    test: /\bcached:\s*false\b/,
    says: 'refuses the cache and forces a fresh fetch',
  },
  {
    id: 'http',
    test: /\b(?:ctx\.)?http\.fetch\s*\(/,
    says: 'makes an outbound HTTP request',
  },
  {
    id: 'mirror',
    test: /\bnew Mirror</,
    says: 'mirrors a VRCNext list',
  },
  {
    id: 'state',
    /*
     * A keyed collection that outlives a call and is named after VRChat data.
     *
     * Only class fields and module-level bindings: a `const` inside a function is a working
     * value, not a second copy of VRCNext's data, and flagging those would bury the real
     * findings. `HTMLElement` and friends are excluded because a `Set<HTMLElement>` named
     * `blocks` is a set of DOM blocks, not of blocked users.
     */
    test: /^(?:\s{0,4}(?:readonly\s+)?#?[\w$]+|\s*(?:const|let)\s+[A-Z][\w$]*)\s*(?::[^=]*)?=\s*new (?:Map|Set|WeakMap)</,
    subject: /\b(?:user|friend|world|avatar|group|instance|moderat|block|mute|player|timeline|image|detail|name)/i,
    exclude: /\b(?:HTMLElement|HTMLInputElement|Element|Node|EventTarget|Disposable|AbortController)\b/,
    says: 'holds VRChat data in memory',
  },
];

/**
 * The reuse marker for a line: on it, or anywhere in the comment block directly above it.
 *
 * A reason worth reading is usually longer than one line, so the whole contiguous comment block
 * is searched rather than just the line above. The reason is returned so a rule can require a
 * particular one.
 */
function markerFor(lines, index) {
  const own = MARKER.exec(lines[index] ?? '');
  if (own?.groups?.reason !== undefined) return own.groups.reason;
  for (let i = index - 1; i >= 0 && COMMENT.test(lines[i] ?? ''); i -= 1) {
    const found = MARKER.exec(lines[i] ?? '');
    if (found?.groups?.reason !== undefined) return found.groups.reason;
  }
  return undefined;
}

/** A `new Mirror<…>(…)` whose constructor call has a second argument. */
function mirrorHasPageFallback(lines, index) {
  // The page fallback is the second argument and may be several lines down.
  const window = lines.slice(index, index + 12).join('\n');
  const call = window.slice(window.indexOf('new Mirror<'));
  let depth = 0;
  for (let i = call.indexOf('('); i < call.length && i >= 0; i += 1) {
    const char = call[i];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return false;
    } else if (char === ',' && depth === 1) return true;
  }
  return false;
}

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function findings(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const found = [];
  lines.forEach((line, index) => {
    const reason = markerFor(lines, index);
    for (const pattern of PATTERNS) {
      if (!pattern.test.test(line)) continue;
      if (pattern.subject !== undefined && !pattern.subject.test(line)) continue;
      if (pattern.exclude?.test(line) === true) continue;
      if (pattern.id === 'mirror') {
        // A page fallback *is* the answer, so a mirror that has one needs no marker. One that
        // does not must say that VRCNext has no page state to read, which is the only honest
        // reason for a mirror to be the sole copy.
        if (!mirrorHasPageFallback(lines, index) && reason?.startsWith('no page state') !== true) {
          found.push({ line: index + 1, id: pattern.id, says: pattern.says, why: 'no page fallback, and no `reuse: no page state`' });
        }
        break;
      }
      if (reason === undefined) {
        found.push({ line: index + 1, id: pattern.id, says: pattern.says, why: 'no reuse marker' });
      }
      break;
    }
  });
  return found;
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const dirs = args.filter((arg) => !arg.startsWith('--'));
if (dirs.length === 0) {
  process.stderr.write('usage: check-reuse.mjs [--json] <dir>...\n');
  process.exit(2);
}

const all = [];
for (const dir of dirs) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const path of files(dir)) {
    for (const found of findings(path)) all.push({ file: relative(process.cwd(), path), ...found });
  }
}

if (json) {
  process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
} else {
  for (const f of all) {
    process.stdout.write(`${f.file}:${String(f.line)}: ${f.says} — ${f.why}.\n`);
  }
  process.stdout.write(`${String(all.length)} unexplained cost(s).\n`);
  if (all.length > 0) {
    process.stdout.write(
      'Each needs `reuse: <why nothing existing answers this>` on its line or the line above.\n'
      + 'Check page-state.ts, ctx.vrchat.name(), and the Mirror fields first — VRCNext usually has it.\n',
    );
  }
}
process.exit(all.length > 0 ? 1 : 0);
