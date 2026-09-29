#!/usr/bin/env node
// Read VRCNext's own C# source and write down the page protocol it implements.
//
//   node scripts/gen-vrcnext-protocol.mjs <path to a VRCNext checkout> [--out DIR]
//
// VRCNext has no published protocol: the page sends `{ action, ...args }` and C# answers with
// `SendToJS(type, payload)`. Everything the plugin system knows about that channel was read out of
// the C# by hand, and nothing checked it stayed true. This extracts it instead:
//
// - actions: every `case "…":` label directly under a `switch (action)`, and every
//   `action == "…"` comparison, across the backend;
// - which of those a Linux build drops before dispatch (`IsWindowsOnlyAction`);
// - each action's arguments: the `msg["…"]` keys its handler reads, following the message into
//   the methods it is passed to (and saying when it escapes somewhere that cannot be followed);
// - events: every `SendToJS("…", …)` with a literal type, and — where the payload is written
//   inline as `new { … }`, or built by a method that returns one — its top-level fields;
// - the element ids and classes the frontend defines, for the selectors plugins depend on.
//
// It writes protocol/vrcnext-protocol.json (the data, pinned to the commit it was read from) and
// packages/api/src/vrcnext-protocol.generated.ts (types only, so plugins get the names in their
// editor at no cost to the bundle). scripts/check-vrcnext-protocol.mjs checks every action,
// argument, event and selector a directory uses against the JSON — the gate runs it over the host
// and the example plugin — and packages/api/src/events.protocol.test.ts makes the compiler check
// the typed event map against the generated types.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const argv = process.argv.slice(2);
const outFlag = argv.indexOf('--out');
/** `--out DIR` writes both files into DIR instead, which is how the tests run this. */
const OUT_DIR = outFlag === -1 ? undefined : argv[outFlag + 1];
if (outFlag !== -1) argv.splice(outFlag, 2);
const JSON_OUT = OUT_DIR === undefined ? join(ROOT, 'protocol', 'vrcnext-protocol.json') : join(OUT_DIR, 'vrcnext-protocol.json');
const TS_OUT = OUT_DIR === undefined
  ? join(ROOT, 'packages', 'api', 'src', 'vrcnext-protocol.generated.ts')
  : join(OUT_DIR, 'vrcnext-protocol.generated.ts');

/** Directories of the checkout that are not the app's backend. */
const SKIPPED = new Set(['.git', 'bin', 'obj', 'build', 'external', 'frontend', 'tools', 'translations', 'voice']);

function fail(message) {
  process.stderr.write(`gen-vrcnext-protocol: ${message}\n`);
  process.exit(1);
}

function csharpFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) csharpFiles(path, found);
    else if (entry.name.endsWith('.cs')) found.push(path);
  }
  return found.sort();
}

/**
 * The source with every comment, string and char literal's *contents* blanked to spaces, so
 * braces and keywords can be counted without being fooled by `"{"` or `// }`. Offsets are kept,
 * so a position in the mask is the same position in the source.
 *
 * Interpolated strings (`$"…{expr}…"`) are the hard part: a hole is code again, and may hold
 * strings of its own (`$"{string.Join(", ", xs)}"`). Holes are therefore lexed as code,
 * recursively, and only the literal text around them is blanked.
 */
function mask(source) {
  const out = source.split('');
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' '; };

  /** Lex code from `i` until an unmatched `}` (when `inHole`) or the end; returns that index. */
  function code(i, inHole) {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      const next = source[i + 1];
      if (c === '/' && next === '/') {
        const end = source.indexOf('\n', i);
        const stop = end === -1 ? source.length : end;
        blank(i, stop);
        i = stop;
      } else if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? source.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (c === '"' || c === '@' || c === '$') {
        let k = i;
        let verbatim = false;
        let interpolated = false;
        while (source[k] === '@' || source[k] === '$') {
          if (source[k] === '@') verbatim = true;
          else interpolated = true;
          k += 1;
        }
        if (source[k] !== '"') { i += 1; continue; }
        i = string(k, verbatim, interpolated);
      } else if (c === '\'') {
        let k = i + 1;
        while (k < source.length && source[k] !== '\'') k += source[k] === '\\' ? 2 : 1;
        blank(i + 1, k);
        i = k + 1;
      } else if (c === '{') {
        depth += 1;
        i += 1;
      } else if (c === '}') {
        if (inHole && depth === 0) return i;
        depth -= 1;
        i += 1;
      } else {
        i += 1;
      }
    }
    return i;
  }

  /** Lex a string whose opening quote is at `q`; returns the index after it closes. */
  function string(q, verbatim, interpolated) {
    if (source.startsWith('"""', q)) {
      const end = source.indexOf('"""', q + 3);
      const stop = end === -1 ? source.length : end + 3;
      blank(q + 1, stop - 1);
      return stop;
    }
    let k = q + 1;
    let from = k;
    while (k < source.length) {
      const ch = source[k];
      if (verbatim && ch === '"' && source[k + 1] === '"') { k += 2; continue; }
      if (!verbatim && ch === '\\') { k += 2; continue; }
      if (interpolated && ch === '{' && source[k + 1] === '{') { k += 2; continue; }
      if (interpolated && ch === '}' && source[k + 1] === '}') { k += 2; continue; }
      if (interpolated && ch === '{') {
        blank(from, k + 1);
        const close = code(k + 1, true);
        blank(close, close + 1);
        k = close + 1;
        from = k;
        continue;
      }
      if (ch === '"') break;
      if (!verbatim && ch === '\n') break; // an unterminated regular string ends at the line
      k += 1;
    }
    blank(from, k);
    return k + 1;
  }

  code(0, false);
  return out.join('');
}

/** Index just past the brace that closes the one at `open`. */
function closing(masked, open) {
  let depth = 0;
  for (let k = open; k < masked.length; k += 1) {
    if (masked[k] === '{') depth += 1;
    else if (masked[k] === '}') {
      depth -= 1;
      if (depth === 0) return k + 1;
    }
  }
  return masked.length;
}

/**
 * `case "x":` labels at the top level of every `switch (action)` block, each with the `msg["…"]`
 * keys read between it and the next label: the arguments that action takes. Labels that share a
 * body (`case "a": case "b":`) share its keys.
 */
function switchActions(source, masked) {
  const found = new Map();
  const header = /switch\s*\(\s*action\s*\)\s*\{/g;
  for (let match = header.exec(masked); match !== null; match = header.exec(masked)) {
    const open = match.index + match[0].length - 1;
    const end = closing(masked, open);
    let depth = 0;
    const label = /case\s+"([A-Za-z0-9_.:-]+)"\s*(?:when[^:]*)?:/y;
    /** Labels waiting for their body, and where that body starts. */
    let group = [];
    let bodyFrom = -1;
    const close = (at) => {
      if (group.length === 0) return;
      const body = { source: source.slice(bodyFrom, at), masked: masked.slice(bodyFrom, at) };
      for (const name of group) found.set(name, [...(found.get(name) ?? []), body]);
      group = [];
    };
    for (let k = open + 1; k < end - 1; k += 1) {
      const ch = masked[k];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      // A `case` at depth 0 belongs to this switch; a nested switch sits deeper.
      if (depth === 0 && masked.startsWith('case', k) && !/[A-Za-z0-9_]/.test(masked[k - 1] ?? '')) {
        label.lastIndex = k;
        const hit = label.exec(source);
        if (hit === null) continue;
        // A label straight after another label joins its group; after a body, it starts anew.
        if (bodyFrom !== -1 && masked.slice(bodyFrom, k).trim() !== '') close(k);
        group.push(hit[1]);
        bodyFrom = k + hit[0].length;
        k = bodyFrom - 1;
      }
    }
    close(end - 1);
  }
  return found;
}

/**
 * Every method whose parameters include a `JObject`, by name: its parameter names and its body.
 * A handler that passes `msg` on (`HandleGetTimelineForUser(msg)`) is read through these.
 */
function handlers(source, masked, into) {
  const header = /\b([A-Z][A-Za-z0-9_]*)\s*\(([^(){};]*\bJObject\b[^(){};]*)\)\s*\{/g;
  for (const match of masked.matchAll(header)) {
    const params = match[2].split(',').map((param) => param.trim().split(/\s+/).pop() ?? '');
    const open = match.index + match[0].length - 1;
    const end = closing(masked, open);
    const list = into.get(match[1]) ?? [];
    list.push({ params, source: source.slice(open, end), masked: masked.slice(open, end) });
    into.set(match[1], list);
  }
}

/**
 * The `name["…"]` keys a body reads from its message, following calls that pass the message on.
 * `complete` is false when the message escapes somewhere this cannot follow, so a key missing from
 * `keys` may still be read.
 */
function readKeys(body, name, methods, depth = 0) {
  const keys = new Set();
  let complete = true;
  const escaped = new RegExp(`\\b${name}\\b(?!\\s*\\[\\s*")`, 'g');
  for (const m of body.source.matchAll(new RegExp(`\\b${name}\\s*\\[\\s*"([A-Za-z0-9_]+)"\\s*\\]`, 'g'))) keys.add(m[1]);
  for (const m of body.source.matchAll(new RegExp(`\\b${name}\\s*\\.\\s*Value<[^>]+>\\(\\s*"([A-Za-z0-9_]+)"`, 'g'))) keys.add(m[1]);
  for (const use of body.masked.matchAll(escaped)) {
    const before = body.masked.slice(0, use.index);
    if (/\.\s*Value<[^>]+>\(\s*$/.test(body.masked.slice(use.index + name.length, use.index + name.length + 20).replace(/^/, '')) ) continue;
    if (/\.\s*$/.test(before) || new RegExp(`\\b${name}\\s*\\.\\s*Value<`).test(body.masked.slice(use.index, use.index + name.length + 12))) continue;
    // Passed as an argument: find the call and the position.
    const call = /([A-Z][A-Za-z0-9_]*)\s*\(([^()]*)$/.exec(before);
    if (call === null) { complete = false; continue; }
    const position = call[2].split(',').length - 1;
    const targets = methods.get(call[1]);
    if (targets === undefined || depth >= 3) {
      // A controller's HandleMessage(action, msg) is its own switch, already read as actions.
      if (call[1] !== 'HandleMessage') complete = false;
      continue;
    }
    for (const target of targets) {
      // A router of its own: its cases were read as actions already.
      if (/switch\s*\(\s*action\s*\)/.test(target.masked)) continue;
      const param = target.params[position];
      if (param === undefined) { complete = false; continue; }
      const inner = readKeys(target, param, methods, depth + 1);
      for (const key of inner.keys) keys.add(key);
      complete &&= inner.complete;
    }
  }
  return { keys, complete };
}

/** Frontend files whose markup, scripts and styles define the page's element ids and classes. */
function frontendFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'i18n') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) frontendFiles(path, found);
    else if (/\.(html|js|css)$/.test(entry.name) && !entry.name.endsWith('.min.js')) found.push(path);
  }
  return found;
}

/**
 * Every element id and class the frontend defines or styles: `id="…"` and `class="…"` in markup
 * and templates, `.id = '…'`, `className = '…'`, `classList.add/toggle('…')`, and the `#id` and
 * `.class` selectors of its stylesheets. Generous on purpose: it answers "does VRCNext have this at
 * all", so a plugin that depends on `#vrcQuickPass` finds out when it goes away.
 */
function domNames(root) {
  const ids = new Set();
  const classes = new Set();
  const word = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
  const addClasses = (text) => { for (const c of text.split(/\s+/)) if (word.test(c)) classes.add(c); };
  for (const file of frontendFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bid\s*=\s*["'`]([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.add(m[1]);
    for (const m of text.matchAll(/\.id\s*=\s*["'`]([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.add(m[1]);
    for (const m of text.matchAll(/\bclass(?:Name)?\s*=\s*(["'`])([^"'`]*)\1/g)) addClasses(m[2].replace(/\$\{[^}]*\}/g, ' '));
    for (const m of text.matchAll(/classList\.(?:add|toggle|remove|contains|replace)\(([^)]*)\)/g)) {
      for (const q of m[1].matchAll(/["'`]([^"'`]+)["'`]/g)) addClasses(q[1]);
    }
    if (file.endsWith('.css') || file.endsWith('.html')) {
      const css = file.endsWith('.css') ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, ' ');
      for (const m of selectors.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.add(m[1]);
      for (const m of selectors.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(m[1]);
    }
    // A script that looks an element up by id is as good as its markup saying it exists.
    for (const m of text.matchAll(/getElementById\(\s*["'`]([A-Za-z_][A-Za-z0-9_-]*)["'`]/g)) ids.add(m[1]);
  }
  return { ids: sorted(ids), classes: sorted(classes) };
}

/** `action == "x"` comparisons, which route a few actions outside any switch. */
function comparedActions(source) {
  const found = new Set();
  for (const match of source.matchAll(/\baction\s*==\s*"([A-Za-z0-9_]+)"/g)) found.add(match[1]);
  return found;
}

/** The prefixes and names a non-Windows build drops before dispatch. */
function windowsOnlyRule(sources) {
  for (const source of sources) {
    const prefixes = /_windowsOnlyActionPrefixes\s*=\s*\{([^}]*)\}/.exec(source);
    if (prefixes === null) continue;
    const names = /IsWindowsOnlyAction[\s\S]*?if\s*\(([^)]*)\)\s*return true;/.exec(source);
    return {
      prefixes: [...prefixes[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
      names: names === null ? [] : [...names[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    };
  }
  return { prefixes: [], names: [] };
}

function isWindowsOnly(action, rule) {
  if (rule.names.includes(action)) return true;
  return rule.prefixes.some((prefix) =>
    action.length > prefix.length && action.startsWith(prefix) && /[A-Z]/.test(action[prefix.length]));
}

/**
 * Top-level member names of the anonymous object starting at `open` (the `{` of `new {`).
 * `a = …` names `a`; a bare `x.y` names `y`, as C# does.
 */
function anonymousFields(masked, open) {
  const end = closing(masked, open);
  const body = masked.slice(open + 1, end - 1);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < body.length; k += 1) {
    const ch = body[k];
    if ('({['.includes(ch)) depth += 1;
    else if (')}]'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) { parts.push(body.slice(start, k)); start = k + 1; }
  }
  parts.push(body.slice(start));
  const fields = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (part === '') continue;
    const named = /^@?([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(part);
    if (named !== null) { fields.push(named[1]); continue; }
    const projected = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(part.replace(/[?!]$/, ''));
    if (projected !== null && /^[A-Za-z_@][A-Za-z0-9_.?@]*$/.test(part)) fields.push(projected[1]);
    else return null; // an expression C# cannot name a member after: give up rather than guess
  }
  return fields;
}

/**
 * Methods whose every `return` is an anonymous object, by name, with the union of its fields:
 * `SendToJS("friendTimelineEvent", BuildFriendTimelinePayload(fev))` is as knowable as an inline
 * `new { … }` once the builder is read. A name defined twice with different shapes is dropped.
 */
function builders(source, masked, into) {
  const header = /\b([A-Z][A-Za-z0-9_]*)\s*\([^;{}()]*(?:\([^()]*\)[^;{}()]*)*\)\s*(\{|=>)/g;
  for (const match of masked.matchAll(header)) {
    const name = match[1];
    let fields = [];
    if (match[2] === '=>') {
      const after = match.index + match[0].length;
      const inline = /^\s*new\s*\{/.exec(masked.slice(after));
      fields = inline === null ? null : anonymousFields(masked, after + inline[0].length - 1);
    } else {
      const open = match.index + match[0].length - 1;
      const body = masked.slice(open, closing(masked, open));
      const returns = [...body.matchAll(/\breturn\b\s*(new\s*\{)?/g)];
      if (returns.length === 0 || returns.some((r) => r[1] === undefined)) fields = null;
      else {
        for (const r of returns) {
          const at = open + r.index + r[0].length - 1;
          const got = anonymousFields(masked, at);
          if (got === null) { fields = null; break; }
          fields.push(...got);
        }
      }
    }
    if (fields === null) continue;
    const known = into.get(name);
    into.set(name, known === undefined ? new Set(fields) : null);
  }
}

/** Every `SendToJS("type", payload)`: the type, and the payload's fields when written inline. */
function events(source, masked, file, into, methods) {
  const call = /\bSendToJS\s*\(\s*"([A-Za-z0-9_.:-]+)"\s*(,)?/g;
  for (const match of source.matchAll(call)) {
    const type = match[1];
    const entry = into.get(type) ?? { fields: new Set(), opaque: false, files: new Set() };
    entry.files.add(file);
    if (match[2] === undefined) {
      into.set(type, entry);
      continue;
    }
    const after = match.index + match[0].length;
    const inline = /^\s*new\s*\{/.exec(masked.slice(after));
    let fields = inline === null ? null : anonymousFields(masked, after + inline[0].length - 1);
    if (inline === null) {
      // `Builder(x)` or `_ctrl.Builder(x)`, resolved through the methods read above.
      const call = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)*([A-Z][A-Za-z0-9_]*)\s*\(/.exec(masked.slice(after));
      const built = call === null ? undefined : methods.get(call[1]);
      if (built) fields = [...built];
    }
    if (fields === null) entry.opaque = true;
    else for (const field of fields) entry.fields.add(field);
    into.set(type, entry);
  }
}

function sorted(set) {
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `'a' | 'b' | …`, wrapped to stay readable and under the line-length rules. */
function union(names) {
  if (names.length === 0) return 'never';
  const lines = [];
  let line = '  ';
  for (const [index, name] of names.entries()) {
    const piece = `${index === 0 ? '' : '| '}'${name}' `;
    if (line.length + piece.length > 100) { lines.push(line.trimEnd()); line = '  '; }
    line += piece;
  }
  lines.push(line.trimEnd());
  return `\n${lines.join('\n')}`;
}

const source = argv[0] ?? process.env.VRCNEXT_SRC;
if (source === undefined) fail('usage: gen-vrcnext-protocol.mjs <path to a VRCNext checkout>');

let commit;
try {
  commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  fail(`${source} is not a git checkout of VRCNext`);
}

const files = csharpFiles(source);
if (files.length === 0) fail(`no C# files under ${source}`);
const texts = files.map((file) => readFileSync(file, 'utf8'));

const masks = texts.map(mask);
const methods = new Map();
const jobjectMethods = new Map();
for (const [index, text] of texts.entries()) {
  builders(text, masks[index], methods);
  handlers(text, masks[index], jobjectMethods);
}

const actions = new Map();
const eventMap = new Map();
for (const [index, text] of texts.entries()) {
  const masked = masks[index];
  for (const [name, bodies] of switchActions(text, masked)) {
    const known = actions.get(name) ?? { keys: new Set(), complete: true };
    for (const body of bodies) {
      const read = readKeys(body, 'msg', jobjectMethods);
      for (const key of read.keys) known.keys.add(key);
      known.complete &&= read.complete;
    }
    actions.set(name, known);
  }
  // Routed by comparison rather than a switch: the arguments are not read here.
  for (const name of comparedActions(text)) if (!actions.has(name)) actions.set(name, { keys: new Set(), complete: false });
  events(text, masked, relative(source, files[index]), eventMap, methods);
}
const rule = windowsOnlyRule(texts);

const actionNames = sorted(new Set(actions.keys()));
const dom = existsSync(join(source, 'frontend')) ? domNames(join(source, 'frontend')) : { ids: [], classes: [] };
const eventNames = sorted(new Set(eventMap.keys()));
const data = {
  source: { repository: 'https://github.com/shinyflvre/VRCNext', commit },
  windowsOnly: rule,
  // Element ids and classes VRCNext's frontend defines, for selectors a plugin or the host uses.
  dom,
  actions: Object.fromEntries(actionNames.map((name) => [name, {
    windowsOnly: isWindowsOnly(name, rule),
    // Keys read from the message where the action is handled (`action` itself aside), following
    // the message into the methods it is passed to. `argsComplete: false` when it escapes somewhere
    // this could not follow, so an argument missing from `args` may still be read.
    args: sorted(new Set([...actions.get(name).keys].filter((key) => key !== 'action'))),
    argsComplete: actions.get(name).complete,
  }])),
  events: Object.fromEntries(eventNames.map((name) => {
    const entry = eventMap.get(name);
    return [name, {
      // `null` when at least one sender builds the payload out of line, so the list may be short.
      fields: entry.opaque ? null : sorted(entry.fields),
      knownFields: sorted(entry.fields),
      sentFrom: sorted(entry.files),
    }];
  })),
};

mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, `${JSON.stringify(data, null, 2)}\n`);

const windowsOnly = actionNames.filter((name) => data.actions[name].windowsOnly);
writeFileSync(TS_OUT, `/**
 * The VRCNext page protocol, as its C# source implements it. Generated by
 * scripts/gen-vrcnext-protocol.mjs from ${data.source.repository} at ${commit}.
 * Do not edit; run \`npm run protocol:update -- <VRCNext checkout>\` instead.
 *
 * Types only: nothing here reaches the bundle. The data, with each event's payload fields where
 * the C# writes them inline, is protocol/vrcnext-protocol.json.
 */

/** Commit of VRCNext these names were read from. */
export type VrcnextSourceCommit = '${commit}';

/** Every action VRCNext's backend dispatches (JS → C#). */
export type VrcnextAction =${union(actionNames)};

/** Actions a Linux or macOS build of VRCNext drops before dispatch. */
export type VrcnextWindowsOnlyAction =${union(windowsOnly)};

/** Every event type VRCNext's backend sends to the page (C# → JS). */
export type VrcnextEvent =${union(eventNames)};

/**
 * The top-level payload fields of each event whose every sender builds the payload where it can
 * be read (\`new { … }\`, or a method that returns one). An event missing here sends at least one
 * payload the generator could not see into.
 */
export interface VrcnextEventFields {
${eventNames
    .filter((name) => data.events[name].fields !== null)
    .map((name) => {
      const fields = union(data.events[name].fields);
      return fields === 'never'
        ? `  readonly ${name}: never;`
        : `  readonly ${name}:${fields.replace(/\n {2}/g, '\n    ')};`;
    })
    .join('\n')}
}
`);

process.stdout.write(
  `${String(actionNames.length)} actions (${String(windowsOnly.length)} Windows-only), ` +
  `${String(eventNames.length)} events, ${String(dom.ids.length)} element ids and ` +
  `${String(dom.classes.length)} classes from ${commit.slice(0, 12)}\n` +
  `wrote ${relative(ROOT, JSON_OUT)} and ${relative(ROOT, TS_OUT)}\n`,
);
