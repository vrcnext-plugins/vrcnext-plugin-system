import assert from 'node:assert/strict';
import { test } from 'vitest';

import { textProblem } from './setting-text.js';

const VARIABLES = { name: 'Who joined', world: 'Where they are' };

test('text that only uses declared variables is fine', () => {
  assert.equal(textProblem('{name} joined {world}', VARIABLES), undefined);
  assert.equal(textProblem('', VARIABLES), undefined);
  assert.equal(textProblem('no placeholders at all', VARIABLES), undefined);
});

test('a name the plugin does not provide is named back', () => {
  assert.equal(textProblem('{nmae} joined', VARIABLES), 'There is no variable called nmae.');
  assert.equal(
    textProblem('{a} {b}', VARIABLES),
    'There are no variables called a and b.',
  );
});

test('an unclosed placeholder is a syntax problem, reported before any name is judged', () => {
  const problem = textProblem('{{ name ', VARIABLES);
  assert.ok(problem !== undefined);
  assert.doesNotMatch(problem, /no variable called/, 'the names cannot be trusted yet');
});

test('expressions are read as expressions: strings are not names, filters are not variables', () => {
  assert.equal(textProblem('{{ "literal" }}', VARIABLES), undefined);
  assert.equal(textProblem('{{ name | upper }}', VARIABLES), undefined);
  assert.equal(textProblem('{{ "x" if world else "y" }}', VARIABLES), undefined);
});

test('a path is judged by its root, because what is inside a value is the value’s business', () => {
  assert.equal(textProblem('{{ name.first }}', VARIABLES), undefined);
  assert.equal(textProblem('{{ nope.first }}', VARIABLES), 'There is no variable called nope.');
});

test('a setting that declares no variables has only its syntax checked', () => {
  assert.equal(textProblem('{anything}', undefined), undefined);
  assert.ok(textProblem('{{ unclosed', undefined) !== undefined);
});
