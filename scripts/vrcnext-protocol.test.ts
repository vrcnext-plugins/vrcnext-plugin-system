/**
 * The two protocol tools, against fixtures small enough to read: a fake VRCNext checkout with
 * each C# construct the generator has to see through, and a fake plugin with each mistake the
 * checker has to catch. The real protocol is checked by the gate itself (scripts/check.sh).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATE = join(HERE, 'gen-vrcnext-protocol.mjs');
const CHECK = join(HERE, 'check-vrcnext-protocol.mjs');

interface Protocol {
  readonly actions: Partial<Record<string, { windowsOnly: boolean; args: string[]; argsComplete: boolean }>>;
  readonly events: Partial<Record<string, { fields: string[] | null; knownFields: string[] }>>;
  readonly dom: { ids: string[]; classes: string[] };
}

interface Problem {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly message: string;
}

let root = '';
let out = '';
let protocol: Protocol;

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const ROUTER = String.raw`
public class MessageRouter
{
    private async Task OnWebMessage(string rawMessage)
    {
        var action = msg["action"]?.ToString() ?? "";
        switch (action)
        {
            case "ready":
                // An interpolation hole holding a string must not end the string: "}" and "{".
                SendToJS("log", new { msg = $"[STARTUP] {string.Join(", ", names.Select(n => $"\"{n}\""))}", color = "sec" });
                break;
            case "vrcGetThing":
            case "vrcGetThingAlias":
                SendToJS("vrcThing", new { id = msg["thingId"]?.ToString(), name });
                break;
            case "vrcDelegated":
                HandleDelegated(msg);
                break;
            case "vrcEscapes":
                Somewhere.Else(msg);
                break;
            case "oscSendThing":
                break;
            case "vrcBuilt":
                SendToJS("vrcBuiltEvent", BuildPayload(thing));
                break;
            case "vrcNested":
                switch (kind) { case "notAnAction": break; }
                break;
        }
    }

    private void HandleDelegated(JObject m) { var id = m["delegatedId"]; }

    public object BuildPayload(Thing t)
    {
        return new { t.Id, label = t.Name, when = $"{t.At:o}" };
    }

#if !WINDOWS
    private static readonly string[] _windowsOnlyActionPrefixes =
        { "osc", "vf" };

    private static bool IsWindowsOnlyAction(string action)
    {
        if (action == "startRelay") return true;
        return false;
    }
#endif
}
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vrcnext-protocol-'));
  const upstream = join(root, 'VRCNext');
  write(join(upstream, 'main', 'MessageRouter.cs'), ROUTER);
  write(join(upstream, 'frontend', 'index.html'), '<div id="vrcQuickPass" class="login-field wide"></div>');
  write(join(upstream, 'frontend', 'app.css'), '.nav-group.popout-open > .x { color: red } #tbMenuItems {}');
  execFileSync('git', ['init', '-q'], { cwd: upstream });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: upstream });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: upstream });
  out = join(root, 'out');
  execFileSync('node', [GENERATE, upstream, '--out', out]);
  protocol = JSON.parse(readFileSync(join(out, 'vrcnext-protocol.json'), 'utf8')) as Protocol;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test('actions are the labels of switch (action), shared bodies share their arguments', () => {
  assert.deepEqual(
    Object.keys(protocol.actions).sort(),
    ['oscSendThing', 'ready', 'startRelay', 'vrcBuilt', 'vrcDelegated', 'vrcEscapes', 'vrcGetThing', 'vrcGetThingAlias', 'vrcNested'],
    'a nested switch contributes nothing, and an interpolation hole does not derail the scan',
  );
  const thing = protocol.actions['vrcGetThing'];
  assert.ok(thing);
  assert.deepEqual(thing.args, ['thingId']);
  assert.equal(thing.argsComplete, true);
  assert.deepEqual(protocol.actions['vrcGetThingAlias']?.args, ['thingId']);
});

test('the message is followed into the method it is passed to, and an escape is admitted', () => {
  assert.deepEqual(protocol.actions['vrcDelegated'], { windowsOnly: false, args: ['delegatedId'], argsComplete: true });
  assert.equal(protocol.actions['vrcEscapes']?.argsComplete, false);
});

test('the Windows-only filter is read from the source, prefixes and names both', () => {
  assert.equal(protocol.actions['oscSendThing']?.windowsOnly, true);
  assert.equal(protocol.actions['startRelay']?.windowsOnly, true);
  assert.equal(protocol.actions['vrcGetThing']?.windowsOnly, false);
});

test('event fields come from inline objects and from methods that return one', () => {
  assert.deepEqual(protocol.events['vrcThing']?.fields, ['id', 'name']);
  assert.deepEqual(protocol.events['log']?.fields, ['color', 'msg']);
  assert.deepEqual(protocol.events['vrcBuiltEvent']?.fields, ['Id', 'label', 'when']);
});

test('frontend ids and classes come from markup and stylesheets', () => {
  for (const id of ['vrcQuickPass', 'tbMenuItems']) assert.ok(protocol.dom.ids.includes(id), id);
  for (const c of ['login-field', 'wide', 'nav-group', 'popout-open', 'x']) assert.ok(protocol.dom.classes.includes(c), c);
  const types = readFileSync(join(out, 'vrcnext-protocol.generated.ts'), 'utf8');
  assert.match(types, /export type VrcnextAction =/);
  assert.match(types, /readonly vrcThing:\n {4}'id' \| 'name';/);
});

function check(files: Record<string, string>): { errors: Problem[]; warnings: Problem[] } {
  const plugin = join(root, `plugin-${String(Math.random()).slice(2)}`);
  for (const [path, text] of Object.entries(files)) write(join(plugin, path), text);
  let stdout: string;
  try {
    stdout = execFileSync('node', [CHECK, '--json', '--protocol', join(out, 'vrcnext-protocol.json'), plugin], { encoding: 'utf8' });
  } catch (error) {
    stdout = (error as { stdout: string }).stdout;
  }
  return JSON.parse(stdout) as { errors: Problem[]; warnings: Problem[] };
}

test('a plugin that names only what VRCNext has passes', () => {
  const result = check({
    'plugin.json': JSON.stringify({ actions: ['vrcGetThing'], events: ['vrcThing', '*'] }),
    'main.ts': [
      "ctx.bridge.request('vrcGetThing', { thingId: id }, { expect: 'vrcThing' });",
      "ctx.events.on('vrcThing', () => undefined);",
      "const pass = document.querySelector<HTMLInputElement>('#vrcQuickPass');",
      "document.querySelectorAll('.nav-group.popout-open');",
      "el.className = 'mine'; document.querySelector('.mine');",
    ].join('\n'),
    // Test files name fakes on purpose and are not read.
    'main.test.ts': "ctx.bridge.send('vrcNoSuchThing');",
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('each kind of mistake is named, with its line', () => {
  const result = check({
    'plugin.json': JSON.stringify({ actions: ['vrcNoSuchAction'], events: ['vrcNoSuchEvent'] }),
    'main.ts': [
      "ctx.bridge.send('vrcGetThin', {});",
      "ctx.bridge.request('vrcGetThing', { thingID: id }, { expect: 'vrcThing' });",
      "ctx.events.on('vrcGetThing', () => undefined);",
      "document.querySelector('#vrcQuickPassword');",
    ].join('\n'),
  });
  const messages = result.errors.map((e) => `${String(e.line)} ${e.message}`);
  for (const expected of [
    '1 VRCNext has no action named vrcGetThin',
    '2 VRCNext\'s vrcGetThing never reads "thingID" (it reads: thingId)',
    '3 vrcGetThing is a VRCNext action, not an event',
    '4 #vrcQuickPassword',
    '0 VRCNext has no action named vrcNoSuchAction',
    '0 VRCNext has no event named vrcNoSuchEvent',
  ]) {
    assert.ok(messages.some((m) => m.includes(expected)), `${expected} in:\n${messages.join('\n')}`);
  }
  assert.equal(result.errors.length, 6);
});

test('a Windows-only action warns unless its line says the caller routes around it', () => {
  const warned = check({ 'main.ts': "bridge.send('oscSendThing', {});" });
  assert.equal(warned.warnings.length, 1);
  assert.match(warned.warnings[0]?.message ?? '', /Linux and macOS/);
  const acknowledged = check({ 'main.ts': "bridge.send('oscSendThing', {}); // vrcnext: windows-only" });
  assert.deepEqual(acknowledged.warnings, []);
});
