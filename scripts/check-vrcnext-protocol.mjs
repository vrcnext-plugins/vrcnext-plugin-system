#!/usr/bin/env node
// Check that every VRCNext action and event a plugin (or the host) names really exists.
//
//   node scripts/check-vrcnext-protocol.mjs [--json] [--protocol FILE] <dir>...
//
// Names come from `plugin.json` (`actions`, `events`) and from the TypeScript sources, by the
// shapes that name them: `.send('…'` / `.request('…', …` / `action: '…'` are actions;
// `.on('…'` / `.once('…'` / `.next('…'` / `expect: '…'` are events; and any other `'vrcXxx'`
// literal must be one or the other. Test files are skipped: they name fakes on purpose.
//
// Selectors are checked too, where they reach the DOM: a string passed straight to
// `querySelector(All)`, `closest`, `matches` or `getElementById`, or a `const` holding one that is
// passed there. Each `#id` and `.class` in it must be something VRCNext's frontend defines, or
// something the checked code creates itself (it appears in one of its other string literals).
//
// Each is checked against protocol/vrcnext-protocol.json, which scripts/gen-vrcnext-protocol.mjs
// reads out of VRCNext's C#. An unknown name is an error: VRCNext ignores an action it does not
// know and never sends an event it does not have, so the code waits for nothing. An action a
// Linux build drops before dispatch is a warning, since it only works on Windows, unless its line
// says `vrcnext: windows-only` to record that the caller already routes around it.
//
// Exit status 1 if any error was found. Copy this file and the JSON into a plugin repository, or
// point it at one from here: `node scripts/check-vrcnext-protocol.mjs ../my-plugin`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PROTOCOL = new URL('../protocol/vrcnext-protocol.json', import.meta.url);
const SKIPPED = new Set(['node_modules', 'dist', '.git', 'coverage']);

/** Host-level names that are not VRCNext's: the plugin system's own events. */
const HOST_EVENTS = new Set(['*']);

const SHAPES = [
  { kind: 'action', pattern: /\.send\(\s*'([A-Za-z0-9_]+)'/g },
  { kind: 'action', pattern: /\.request\(\s*'([A-Za-z0-9_]+)'\s*,/g },
  { kind: 'action', pattern: /\baction:\s*'([A-Za-z0-9_]+)'/g },
  { kind: 'event', pattern: /(?:^|[^\w$])(?:on|once|next)\(\s*'([A-Za-z0-9_]+)'/g },
  { kind: 'event', pattern: /\bexpect:\s*'([A-Za-z0-9_]+)'/g },
  { kind: 'either', pattern: /'(vrc[A-Z][A-Za-z0-9_]*)'/g },
];

/** Receivers whose `.send(` / `.on(` are not VRCNext's. */
const FOREIGN = /(?:osc|native|socket|ws|http|permissions|emitter|signal|hub|bag|ui|toast|menu)\s*\.\s*(?:send|request|on|once|next)\(\s*'$/i;

export function sources(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, found);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      found.push(path);
    } else if (entry.name === 'plugin.json') {
      found.push(path);
    }
  }
  return found;
}

/** Top-level keys of the object literal whose `{` is at `open`; spreads are skipped. */
function objectKeys(text, open) {
  const keys = [];
  let depth = 0;
  let quote = '';
  let start = open + 1;
  const take = (piece) => {
    const trimmed = piece.trim();
    if (trimmed === '' || trimmed.startsWith('...')) return;
    const key = /^['"]?([A-Za-z_$][A-Za-z0-9_$]*)['"]?\s*(?::|$)/.exec(trimmed);
    if (key !== null) keys.push(key[1]);
  };
  for (let k = open; k < text.length; k += 1) {
    const ch = text[k];
    if (quote !== '') {
      if (ch === '\\') k += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('{[('.includes(ch)) depth += 1;
    else if ('}])'.includes(ch)) {
      depth -= 1;
      if (depth === 0) { take(text.slice(start, k)); return keys; }
    } else if (ch === ',' && depth === 1) { take(text.slice(start, k)); start = k + 1; }
  }
  return keys;
}

/**
 * The argument keys an action use passes, when they are written where the name is:
 * `.send('x', { a, b })`, `.request('x', { a }, …)`, or `{ action: 'x', args: { a } }`.
 * `undefined` when they are built elsewhere.
 */
function argsAt(text, after, shape) {
  const rest = text.slice(after, after + 400);
  if (shape === 'call') {
    // `.request('x',` already ate its comma; `.send('x'` has not.
    const next = /^\s*,?\s*\{/.exec(rest);
    return next === null ? undefined : objectKeys(text, after + next[0].length - 1);
  }
  const args = /^[^{}]*?\bargs:\s*\{/.exec(rest);
  return args === null ? undefined : objectKeys(text, after + args[0].length - 1);
}

/** `{ kind, name, file, line }` for every name one file uses. */
export function uses(path, root) {
  const text = readFileSync(path, 'utf8');
  const file = relative(root, path);
  const found = [];
  if (path.endsWith('plugin.json')) {
    let manifest;
    try { manifest = JSON.parse(text); } catch { return found; }
    for (const name of manifest.actions ?? []) found.push({ kind: 'action', name, file, line: 0 });
    for (const name of manifest.events ?? []) found.push({ kind: 'event', name, file, line: 0 });
    return found;
  }
  const lines = text.split('\n');
  const offsets = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  for (const [index, line] of lines.entries()) {
    const acknowledged = line.includes('vrcnext: windows-only');
    const seen = new Set();
    for (const { kind, pattern } of SHAPES) {
      for (const match of line.matchAll(pattern)) {
        const name = match[1];
        if (seen.has(name)) continue;
        if (kind !== 'either' && FOREIGN.test(line.slice(0, match.index + match[0].length - name.length - 1) + "'")) continue;
        seen.add(name);
        const use = { kind, name, file, line: index + 1, acknowledged };
        if (kind === 'action' && pattern.source !== SHAPES[2].pattern.source) {
          use.args = argsAt(text, offsets[index] + match.index + match[0].length, 'call');
        } else if (kind === 'action') {
          use.args = argsAt(text, offsets[index] + match.index + match[0].length, 'property');
        }
        found.push(use);
      }
    }
  }
  return found;
}

const DOM_CALL = /\b(querySelector(?:All)?|closest|matches|getElementById)(?:<[^<>()]*>)?\(\s*(?:(['"`])([^'"`$]*)\2|([A-Za-z_$][A-Za-z0-9_$]*)\s*[,)])/g;

/** Every string literal in a file, with where it starts. */
function literals(text) {
  return [...text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => ({ value: m[2], index: m.index }));
}

/** `#id` and `.class` tokens in a selector; `getElementById` takes a bare id. */
function selectorTokens(selector, byId) {
  if (byId) return [{ kind: 'id', name: selector }];
  const tokens = [];
  const bare = selector.replace(/\[[^\]]*\]/g, ' ').replace(/:[a-z-]+\([^)]*\)/g, ' ');
  for (const m of bare.matchAll(/([#.])(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) {
    tokens.push({ kind: m[1] === '#' ? 'id' : 'class', name: m[2] });
  }
  return tokens;
}

/** `{ file, line, name, kind, selector }` for every VRCNext id and class a file's DOM queries name. */
export function selectorUses(path, root) {
  if (path.endsWith('plugin.json')) return [];
  const text = readFileSync(path, 'utf8');
  const file = relative(root, path);
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  const constants = new Map();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(['"`])([^'"`$]*)\2/g)) {
    constants.set(m[1], { value: m[3], index: m.index });
  }
  const found = [];
  for (const m of text.matchAll(DOM_CALL)) {
    const byId = m[1] === 'getElementById';
    const constant = m[4] === undefined ? undefined : constants.get(m[4]);
    const selector = m[3] ?? constant?.value;
    if (selector === undefined) continue;
    const index = constant?.index ?? m.index;
    for (const token of selectorTokens(selector, byId)) found.push({ ...token, selector, file, line: lineAt(index) });
  }
  return found;
}

/**
 * Check `dirs` against the protocol. Returns `{ errors, warnings, source }`, each problem a
 * `{ file, line, name, kind, message }`.
 */
export function check(dirs, protocol = JSON.parse(readFileSync(PROTOCOL, 'utf8'))) {
  const errors = [];
  const warnings = [];
  const ids = new Set(protocol.dom.ids);
  const classes = new Set(protocol.dom.classes);
  for (const dir of dirs) {
    const files = sources(dir);
    // Names the checked code makes itself: any word in a string literal that is not a selector.
    const own = new Set();
    for (const path of files) {
      if (path.endsWith('plugin.json')) continue;
      for (const { value } of literals(readFileSync(path, 'utf8'))) {
        if (/^\s*[#.[]/.test(value)) continue;
        for (const w of value.matchAll(/-?[A-Za-z_][A-Za-z0-9_-]*/g)) own.add(w[0]);
      }
    }
    for (const path of files) {
      for (const use of selectorUses(path, process.cwd())) {
        const defined = use.kind === 'id' ? ids.has(use.name) : classes.has(use.name);
        if (!defined && !own.has(use.name)) {
          errors.push({
            ...use,
            message: `${use.kind === 'id' ? '#' : '.'}${use.name} (in "${use.selector}") is neither in VRCNext's frontend nor created here`,
          });
        }
      }
    }
    for (const path of files) {
      for (const use of uses(path, process.cwd())) {
        const action = protocol.actions[use.name];
        const event = protocol.events[use.name] ?? (HOST_EVENTS.has(use.name) ? {} : undefined);
        // A bare 'vrcXxx' literal can also be a payload field VRCNext sends (`vrcRunning`).
        const field = use.kind === 'either' && Object.values(protocol.events).some((e) => e.knownFields.includes(use.name));
        const known = use.kind === 'action' ? action : use.kind === 'event' ? event : action ?? event ?? (field ? {} : undefined);
        if (known === undefined) {
          const other = use.kind === 'action' ? event : use.kind === 'event' ? action : undefined;
          errors.push({
            ...use,
            message: other === undefined
              ? `VRCNext has no ${use.kind === 'either' ? 'action or event' : use.kind} named ${use.name}`
              : `${use.name} is a VRCNext ${use.kind === 'action' ? 'event' : 'action'}, not ${use.kind === 'action' ? 'an action' : 'an event'}`,
          });
        } else if (use.kind === 'action' && use.args !== undefined && action?.argsComplete === true) {
          for (const key of use.args.filter((arg) => !action.args.includes(arg))) {
            errors.push({ ...use, message: `VRCNext's ${use.name} never reads "${key}" (it reads: ${action.args.join(', ') || 'nothing'})` });
          }
        }
        if (known !== undefined && use.kind !== 'event' && action?.windowsOnly === true && use.acknowledged !== true) {
          warnings.push({ ...use, message: `${use.name} is dropped by VRCNext on Linux and macOS (Windows only)` });
        }
      }
    }
  }
  return { errors, warnings, source: protocol.source };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const at = args.indexOf('--protocol');
  // `--protocol FILE` checks against another generated protocol, which is how the tests run this.
  const protocolFile = at === -1 ? undefined : args[at + 1];
  if (at !== -1) args.splice(at, 2);
  const dirs = args.filter((arg) => arg !== '--json');
  if (dirs.length === 0 || !dirs.every((dir) => existsSync(dir))) {
    process.stderr.write('usage: check-vrcnext-protocol.mjs [--json] <dir>...\n');
    process.exit(2);
  }
  const result = protocolFile === undefined ? check(dirs) : check(dirs, JSON.parse(readFileSync(protocolFile, 'utf8')));
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const where = (p) => (p.line === 0 ? p.file : `${p.file}:${String(p.line)}`);
    for (const p of result.errors) process.stdout.write(`error   ${where(p)}  ${p.message}\n`);
    for (const p of result.warnings) process.stdout.write(`warning ${where(p)}  ${p.message}\n`);
    process.stdout.write(
      `${String(result.errors.length)} error(s), ${String(result.warnings.length)} warning(s) ` +
      `against VRCNext ${result.source.commit.slice(0, 12)}\n`,
    );
  }
  process.exit(result.errors.length > 0 ? 1 : 0);
}
