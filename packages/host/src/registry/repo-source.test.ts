import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parseRepoSource, rawUrlFor } from './repo-source.js';

test('accepts owner/repo shorthand as GitHub', () => {
  const { source, error } = parseRepoSource('bluscream/my-plugins');
  assert.equal(error, undefined);
  assert.ok(source);
  assert.equal(source.forge, 'github');
  assert.equal(source.owner, 'bluscream');
  assert.equal(source.ref, 'main');
  assert.equal(source.rawBase.href, 'https://raw.githubusercontent.com/bluscream/my-plugins/main/');
});

test('accepts a GitHub URL with and without a .git suffix', () => {
  for (const input of [
    'https://github.com/bluscream/my-plugins',
    'https://github.com/bluscream/my-plugins.git',
    'https://github.com/bluscream/my-plugins/',
  ]) {
    const { source, error } = parseRepoSource(input);
    assert.equal(error, undefined, input);
    assert.ok(source, input);
    assert.equal(source.repo, 'my-plugins');
  }
});

test('reads the branch out of a /tree/ URL', () => {
  const { source } = parseRepoSource('https://github.com/o/r/tree/release/2026');
  assert.ok(source);
  assert.equal(source.ref, 'release/2026');
  assert.equal(source.rawBase.href, 'https://raw.githubusercontent.com/o/r/release/2026/');
});

test('builds a Gitea raw base for a self-hosted forge', () => {
  const { source } = parseRepoSource('https://git.example.com/o/r');
  assert.ok(source);
  assert.equal(source.forge, 'gitea');
  assert.equal(source.rawBase.href, 'https://git.example.com/o/r/raw/branch/main/');
});

test('rejects non-https and malformed URLs', () => {
  for (const input of [
    'http://github.com/o/r',
    'ftp://github.com/o/r',
    'not a url',
    '',
    '   ',
    'https://github.com/only-owner',
  ]) {
    const { source, error } = parseRepoSource(input);
    assert.equal(source, undefined, input);
    assert.ok(error);
  }
});

test('rejects traversal and unsupported characters in path segments', () => {
  for (const input of [
    'https://github.com/../etc/passwd',
    'https://github.com/o/r/tree/../../x',
    '../evil/repo',
  ]) {
    const { source } = parseRepoSource(input);
    assert.equal(source, undefined, input);
  }
});

test('rejects a URL shape that is not a repo or a tree link', () => {
  const { source, error } = parseRepoSource('https://github.com/o/r/issues/4');
  assert.equal(source, undefined);
  assert.match(error ?? '', /tree/);
});

test('resolves entry paths under the raw base', () => {
  const { source } = parseRepoSource('o/r');
  assert.ok(source);
  assert.equal(
    rawUrlFor(source, 'dist/plugin.js').href,
    'https://raw.githubusercontent.com/o/r/main/dist/plugin.js',
  );
});
