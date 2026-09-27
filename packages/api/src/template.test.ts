import assert from 'node:assert/strict';
import { test } from 'vitest';

import { TemplateError, renderTemplate, templatePlaceholders, validateTemplate } from './template.js';

const V = { name: 'Tupper', rejoin: true, inGroup: undefined, pcRank: 'Good', count: 3, tags: ['a', 'b'], avatar: '', nested: { deep: 'x' } };

test('shorthand and full placeholders substitute; unknown names render empty', () => {
  assert.equal(renderTemplate('Hi {name} / {{ name }} / {{ nested.deep }} / [{{ nope }}]', V), 'Hi Tupper / Tupper / x / []');
});

test('drops a line whose placeholders all came out empty, keeps literal lines', () => {
  const template = 'Player {name}\nIn Group: {inGroup}\nRejoin: {{ rejoin }}\n---';
  assert.equal(renderTemplate(template, V), 'Player Tupper\nRejoin: true\n---');
  assert.equal(renderTemplate(template, V, { dropEmptyLines: false }), 'Player Tupper\nIn Group: \nRejoin: true\n---');
});

test('both conditional forms, comparisons and boolean operators', () => {
  assert.equal(renderTemplate('{{ "yes" if rejoin else "no" }}', V), 'yes');
  assert.equal(renderTemplate('{{ inGroup ? "yes" : "no" }}', V), 'no');
  assert.equal(renderTemplate('{{ count > 2 and pcRank == "Good" }}', V), 'true');
  assert.equal(renderTemplate('{{ not rejoin || count >= 3 }}', V), 'true');
  assert.equal(renderTemplate('{{ "n=" + count + 1 }}', V), 'n=31');
  assert.equal(renderTemplate('{{ count + 1 }}', V), '4');
  assert.equal(renderTemplate('{{ (count - 1) + "!" }}', V), '2!', 'parenthesised arithmetic');
  assert.equal(renderTemplate('{{ name | default: ("x" | upper) }}', V), 'Tupper', 'parentheses reopen filters inside arguments');
});

test('if blocks with elif and else, spanning lines', () => {
  const template = '{% if inGroup == true %}member{% elif inGroup == false %}NOT A MEMBER{% else %}unknown{% endif %}';
  assert.equal(renderTemplate(template, V), 'unknown');
  assert.equal(renderTemplate(template, { ...V, inGroup: false }), 'NOT A MEMBER');
  assert.equal(renderTemplate('A{% if rejoin %}\nB\n{% endif %}C', V), 'A\nB\nC');
});

test('filters, with colon and parenthesis argument styles', () => {
  assert.equal(renderTemplate('{{ pcRank | upper }} {{ name | lower | capitalize }}', V), 'GOOD Tupper');
  assert.equal(renderTemplate('{{ avatar | default: "unknown avatar" }}', V), 'unknown avatar');
  assert.equal(renderTemplate('{{ rejoin | yesno("yes", "no") }} {{ inGroup | yesno: "y", "n", "?" }}', V), 'yes ?');
  assert.equal(renderTemplate('{{ tags | join: "+" }} {{ tags | length }}', V), 'a+b 2');
  assert.equal(renderTemplate('{{ name | replace: "T", "t" | truncate: 3, "" }}', V), 'tup');
});

test('a filter result feeds the drop rule like any placeholder', () => {
  assert.equal(renderTemplate('x: {{ avatar | trim }}\ny', V), 'y');
});

test('broken templates and unknown filters are TemplateErrors; validate reports them', () => {
  assert.throws(() => renderTemplate('{{ name', V), TemplateError);
  assert.throws(() => renderTemplate('{% if rejoin %}x', V), /endif/);
  assert.throws(() => renderTemplate('{{ name | explode }}', V), /Unknown filter/);
  assert.throws(() => renderTemplate('{% for x in tags %}{% endfor %}', V), /Unknown block/);
  assert.equal(validateTemplate('{{ name }}'), undefined);
  assert.match(validateTemplate('{{ }}')?.message ?? '', /Unexpected/);
});

test('no way out of the values: prototypes and functions are not reachable', () => {
  assert.equal(renderTemplate('{{ name.constructor }}{{ nested.__proto__ }}{{ constructor.name }}', V), '');
  assert.equal(renderTemplate('{{ tags.length }}', V), '', 'array properties are not exposed; use the filter');
});

test('templatePlaceholders lists names once, in order, including those inside blocks', () => {
  assert.deepEqual(templatePlaceholders('{b} {{ a | default: c }} {% if b and d.e %}{{ b }}{% endif %}'), ['b', 'a', 'c', 'd']);
});
