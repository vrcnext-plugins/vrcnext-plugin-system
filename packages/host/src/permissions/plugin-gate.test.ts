import assert from 'node:assert/strict';
import { test } from 'vitest';

import { PermissionError, parsePluginManifest, type Logger, type PluginManifest } from '@vrcnext/plugin-api';

import { MemoryStateService } from '../state/state-service.js';
import { PermissionBroker } from './broker.js';
import { GrantStore } from './grant-store.js';
import { PluginGate } from './plugin-gate.js';
import { eventPrompt } from './prompts.js';
import type { Decision } from './types.js';

const logger: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, scoped: () => logger };

function manifest(): PluginManifest {
  const { manifest: parsed } = parsePluginManifest({
    id: 'kitchen-sink',
    name: 'Kitchen Sink',
    version: '1.0.0',
    apiVersion: '^0.2.0',
    permissions: ['host:events'],
    optionalPermissions: ['network'],
    events: ['friendTimelineEvent'],
  });
  assert.ok(parsed);
  return parsed;
}

function gate(answer: Decision): { gate: PluginGate; asked: string[] } {
  const asked: string[] = [];
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: { ask: (request) => { asked.push(request.title); return Promise.resolve(answer); } },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const g = new PluginGate(manifest(), broker, logger, new AbortController().signal);
  g.seedDeclared();
  return { gate: g, asked };
}

test('an undeclared category is refused outright, without a prompt', () => {
  const { gate: g, asked } = gate('allow');
  assert.throws(() => { g.requireCategory('osc'); }, PermissionError);
  assert.deepEqual(asked, []);
  assert.equal(g.has('osc'), false);
});

test('a declared event runs its effect synchronously; an undeclared one runs after the allow', async () => {
  const { gate: g, asked } = gate('allow');
  const order: string[] = [];
  g.whenAllowed(eventPrompt(g.subject, 'friendTimelineEvent'), () => { order.push('declared'); });
  g.whenAllowed(eventPrompt(g.subject, 'oscParams'), () => { order.push('asked'); });
  assert.deepEqual(order, ['declared']);
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(order, ['declared', 'asked']);
  assert.deepEqual(asked, ['Plugin Kitchen Sink (kitchen-sink) wants to listen to oscParams']);
});

test('request() grants an optional category and has() reflects it; a required one is not requestable twice', async () => {
  const { gate: g } = gate('allow');
  assert.equal(g.has('network'), false);
  assert.equal(await g.request('network'), true);
  assert.equal(g.has('network'), true);
  assert.equal(await g.request('host:events'), true, 'already declared');
  await assert.rejects(g.request('osc'), PermissionError);
});

test('request() resolves false on deny rather than throwing', async () => {
  const { gate: g } = gate('deny');
  assert.equal(await g.request('network'), false);
  assert.equal(g.has('network'), false);
});

test('an event the manifest does not list is refused, not prompted', () => {
  const { gate: g, asked } = gate('allow');
  g.requireDeclared('host:events', 'friendTimelineEvent');
  assert.throws(
    () => { g.requireDeclared('host:events', 'vrcUser'); },
    (error: unknown) => error instanceof PermissionError && error.message.includes(String.raw`"events"`),
  );
  // Refusing without asking is the point: the enable dialog listed the events, so a prompt for
  // one it did not list would make that list a half-truth.
  assert.deepEqual(asked, []);
});

test('an action the manifest does not list is refused too', () => {
  const { gate: g } = gate('allow');
  assert.throws(
    () => { g.requireDeclared('host:actions', 'vrcLogin'); },
    (error: unknown) => error instanceof PermissionError && error.message.includes(String.raw`"actions"`),
  );
});

test('"*" declares the whole stream, for onAny', () => {
  const { manifest: parsed } = parsePluginManifest({
    id: 'watcher',
    name: 'Watcher',
    version: '1.0.0',
    apiVersion: '^0.3.0',
    permissions: ['host:events'],
    events: ['*'],
  });
  assert.ok(parsed);
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: { ask: () => Promise.resolve('allow' as Decision) },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const g = new PluginGate(parsed, broker, logger, new AbortController().signal);
  g.seedDeclared();
  g.requireDeclared('host:events', '*');
  g.requireDeclared('host:events', 'anythingAtAll');
});

function pendingGate(): { gate: PluginGate; lifetime: AbortController; answer: (decision: Decision) => void; asked: string[] } {
  const asked: string[] = [];
  let answer: (decision: Decision) => void = () => undefined;
  const broker = new PermissionBroker({
    grants: new GrantStore(new MemoryStateService()),
    prompt: {
      ask: (request) => {
        asked.push(request.title);
        return new Promise<Decision>((resolve) => { answer = resolve; });
      },
    },
    onUninstall: () => Promise.resolve(),
    log: () => undefined,
  });
  const lifetime = new AbortController();
  const g = new PluginGate(manifest(), broker, logger, lifetime.signal);
  g.seedDeclared();
  return { gate: g, lifetime, answer: (decision) => { answer(decision); }, asked };
}

test('an effect whose plugin was disabled while the prompt was open never runs', async () => {
  const f = pendingGate();
  let ran = false;
  f.gate.whenAllowed(eventPrompt(f.gate.subject, 'oscParams'), () => { ran = true; });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  f.lifetime.abort(new Error('Plugin deactivated.'));
  f.answer('allow');
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(ran, false);
});

test('check() rejects once the plugin is disabled, even though the user allowed it afterwards', async () => {
  const f = pendingGate();
  const pending = f.gate.check(eventPrompt(f.gate.subject, 'oscParams'));
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  f.lifetime.abort(new Error('Plugin deactivated.'));
  await assert.rejects(pending, /Plugin deactivated/);
  f.answer('allow');
});

test('a prompt still queued when its plugin is disabled is never shown', async () => {
  const f = pendingGate();
  const first = f.gate.check(eventPrompt(f.gate.subject, 'oscParams'));
  const second = f.gate.check(eventPrompt(f.gate.subject, 'friendOnline'));
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  f.lifetime.abort(new Error('Plugin deactivated.'));
  f.answer('allow');
  await assert.rejects(first);
  await assert.rejects(second);
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(f.asked.length, 1);
});
