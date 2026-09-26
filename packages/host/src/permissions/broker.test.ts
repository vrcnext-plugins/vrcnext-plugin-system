/**
 * The decision logic without a DOM: the prompt is a scripted fake, the state store a Map.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { PermissionError, type PluginId } from '@vrcnext/plugin-api';

import { MemoryStateService } from '../state/state-service.js';
import { PermissionBroker } from './broker.js';
import { GrantStore } from './grant-store.js';
import { actionPrompt, bridgePrompt, networkPrompt } from './prompts.js';
import type { Decision, PermissionPrompt, PromptRequest } from './types.js';

const plugin = { id: 'friend-alerts' as PluginId, name: 'Friend alerts' };

/** Answers in order; records what was asked. Resolves each prompt only when released. */
class ScriptedPrompt implements PermissionPrompt {
  readonly asked: PromptRequest[] = [];
  readonly #answers: Decision[];
  readonly #release: (() => void)[] = [];
  /** Releases granted before a prompt was open; the next ask consumes one. */
  #early = 0;
  constructor(answers: Decision[]) {
    this.#answers = answers;
  }
  ask(request: PromptRequest): Promise<Decision> {
    this.asked.push(request);
    const answer = this.#answers.shift() ?? 'deny';
    if (this.#early > 0) {
      this.#early -= 1;
      return Promise.resolve(answer);
    }
    return new Promise((resolve) => {
      this.#release.push(() => { resolve(answer); });
    });
  }
  /** Answer the oldest open prompt, or the next one to open. */
  release(): void {
    const next = this.#release.shift();
    if (next === undefined) this.#early += 1;
    else next();
  }
  get open(): number {
    return this.#release.length;
  }
}

interface Fixture {
  readonly broker: PermissionBroker;
  readonly prompt: ScriptedPrompt;
  readonly state: MemoryStateService;
  readonly grants: GrantStore;
  readonly uninstalled: string[];
}

async function fixture(answers: Decision[], saved: readonly { kind: 'network'; target: string }[] = []): Promise<Fixture> {
  const state = new MemoryStateService();
  if (saved.length > 0) await state.set('host', `grants:${plugin.id}`, saved);
  const grants = new GrantStore(state);
  await grants.load();
  const prompt = new ScriptedPrompt(answers);
  const uninstalled: string[] = [];
  const broker = new PermissionBroker({
    grants,
    prompt,
    onUninstall: (id) => { uninstalled.push(id); return Promise.resolve(); },
    log: () => undefined,
  });
  broker.loadSaved();
  return { broker, prompt, state, grants, uninstalled };
}

const github = (): PromptRequest => networkPrompt(plugin, new URL('https://api.github.com/x'), undefined);

test('an allowed target is cached for the session and never re-asked', async () => {
  const f = await fixture(['allow']);
  const first = f.broker.ensure(github());
  f.prompt.release();
  await first;
  await f.broker.ensure(github());
  assert.equal(f.prompt.asked.length, 1);
  assert.equal(f.broker.isAllowed(plugin.id, 'network', 'api.github.com'), true);
  assert.deepEqual(f.state.writes, [], 'a session allow is never persisted');
});

test('save persists the grant under grants:<id> and revoke removes it and prompts again', async () => {
  const f = await fixture(['save', 'allow']);
  const first = f.broker.ensure(github());
  f.prompt.release();
  await first;
  assert.deepEqual(await f.state.get('host', 'grants:friend-alerts'), [{ kind: 'network', target: 'api.github.com' }]);
  assert.deepEqual(f.broker.savedGrants(plugin.id), [{ kind: 'network', target: 'api.github.com' }]);

  await f.broker.revoke(plugin.id, { kind: 'network', target: 'api.github.com' });
  assert.equal(f.broker.isAllowed(plugin.id, 'network', 'api.github.com'), false);
  assert.equal(await f.state.get('host', 'grants:friend-alerts'), undefined);
  const again = f.broker.ensure(github());
  f.prompt.release();
  await again;
  assert.equal(f.prompt.asked.length, 2);
});

test('saved grants loaded at boot are one lookup, no prompt', async () => {
  const f = await fixture([], [{ kind: 'network', target: 'api.github.com' }]);
  await f.broker.ensure(github());
  assert.equal(f.prompt.asked.length, 0);
});

test('deny rejects with the kind and target, and is remembered for the session', async () => {
  const f = await fixture(['deny']);
  const first = f.broker.ensure(github());
  f.prompt.release();
  await assert.rejects(first, (error: unknown) => {
    assert.ok(error instanceof PermissionError);
    assert.equal(error.permission, 'network');
    assert.equal(error.target, 'api.github.com');
    return true;
  });
  await assert.rejects(f.broker.ensure(github()), PermissionError);
  assert.equal(f.prompt.asked.length, 1, 'no re-prompt this session');
});

test('identical concurrent requests share one prompt; different ones queue one at a time', async () => {
  const f = await fixture(['allow', 'allow']);
  const a = f.broker.ensure(github());
  const b = f.broker.ensure(github());
  const c = f.broker.ensure(actionPrompt(plugin, 'getFriends', {}));
  await Promise.resolve();
  assert.equal(f.prompt.open, 1, 'one modal at a time');
  assert.equal(f.prompt.asked[0]?.target, 'api.github.com');
  f.prompt.release();
  await Promise.all([a, b]);
  await Promise.resolve();
  assert.equal(f.prompt.asked.length, 2);
  assert.equal(f.prompt.asked[1]?.target, 'getFriends');
  f.prompt.release();
  await c;
});

test('uninstall runs the hook, rejects the call and drops the plugin’s session decisions', async () => {
  const f = await fixture(['allow', 'uninstall']);
  const first = f.broker.ensure(github());
  f.prompt.release();
  await first;
  const second = f.broker.ensure(bridgePrompt(plugin, 'notify', 'send', { title: 'x' }));
  f.prompt.release();
  await assert.rejects(second, PermissionError);
  assert.deepEqual(f.uninstalled, ['friend-alerts']);
  assert.equal(f.broker.isAllowed(plugin.id, 'network', 'api.github.com'), false);
});

test('seed grants declared targets for the session without touching a session deny', async () => {
  const f = await fixture(['deny']);
  const denied = f.broker.ensure(github());
  f.prompt.release();
  await assert.rejects(denied, PermissionError);
  f.broker.seed(plugin.id, 'network', ['api.github.com', 'example.org']);
  assert.equal(f.broker.isAllowed(plugin.id, 'network', 'example.org'), true);
  assert.equal(f.broker.isAllowed(plugin.id, 'network', 'api.github.com'), false);
});

test('forgetAll clears saved grants and the cache', async () => {
  const f = await fixture([], [{ kind: 'network', target: 'api.github.com' }]);
  await f.broker.forgetAll(plugin.id);
  assert.equal(f.broker.isAllowed(plugin.id, 'network', 'api.github.com'), false);
  assert.deepEqual(f.broker.savedGrants(plugin.id), []);
});

test('prompt titles follow the documented wording', () => {
  assert.equal(
    networkPrompt(plugin, new URL('https://api.github.com/x'), { method: 'post', body: 'x' }).title,
    'Plugin Friend alerts (friend-alerts) wants to send data to api.github.com',
  );
  assert.equal(github().title, 'Plugin Friend alerts (friend-alerts) wants to request data from api.github.com');
  assert.equal(bridgePrompt(plugin, 'notify', 'send', {}).title, 'Plugin Friend alerts (friend-alerts) wants to call the bridge: notify/send');
  const big = bridgePrompt(plugin, 'notify', 'send', { blob: 'x'.repeat(10_000) });
  assert.match(big.details[0]?.value ?? '', /more characters not shown/);
});
