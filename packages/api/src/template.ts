/**
 * A small, safe template language for user-editable messages.
 *
 * A notification format is user input, so it must not be able to run code: no `new Function`,
 * no method calls, no reaching into prototypes. Full engines that are safe (LiquidJS) weigh more
 * than the whole plugin bundle and cannot be resolved by the bridge, which builds from source
 * with no package manager; the ones that are small compile templates with `new Function`. This
 * is the middle: Jinja-shaped syntax, evaluated by a walker over a fixed grammar.
 *
 * ```text
 * Player {name} joined                         {name}          shorthand for {{ name }}
 * 18+: {{ "yes" if ageVerified else "no" }}    if/else         Python-style conditional
 * Rejoin: {{ rejoin ? "yes" : "no" }}          ?:              the same, C-style
 * {% if inGroup == false %}NOT A MEMBER{% endif %}
 * {{ pcRank | upper }} · {{ avatar | default: "unknown avatar" }}
 * ```
 *
 * Expressions: literals (`"text"`, `12`, `true`, `null`), names with dotted paths (`a.b`),
 * `== != < <= > >=`, `and or not` (also `&& || !`), `+` for numbers and strings, the two
 * conditional forms, and filters with `|`. Filters: `upper lower capitalize trim length default
 * yesno join replace truncate`. A name that is not in the values renders empty.
 *
 * Lines: a line that contained placeholders which all came out empty is dropped, so
 * `In Group: {inGroup}` disappears when the fact is not applicable. Literal lines stay.
 */

export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly TemplateValue[]
  | { readonly [key: string]: TemplateValue };

export type TemplateValues = Readonly<Record<string, TemplateValue>>;

export interface RenderOptions {
  /** Drop lines whose placeholders all rendered empty. Default `true`. */
  readonly dropEmptyLines?: boolean;
}

/** A template that does not parse, or a filter that does not exist. Never thrown for a missing value. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

// ---------------------------------------------------------------------------------------------
// Expressions

type Expr =
  | { readonly kind: 'literal'; readonly value: TemplateValue }
  | { readonly kind: 'name'; readonly path: readonly string[] }
  | { readonly kind: 'unary'; readonly op: 'not' | 'neg'; readonly operand: Expr }
  | { readonly kind: 'binary'; readonly op: string; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'cond'; readonly test: Expr; readonly then: Expr; readonly otherwise: Expr }
  | { readonly kind: 'filter'; readonly name: string; readonly input: Expr; readonly args: readonly Expr[] };

interface Token {
  readonly type: 'num' | 'str' | 'name' | 'op' | 'end';
  readonly text: string;
}

const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '!', '?', ':', '|', '(', ')', '.', ',', '[', ']'];
const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'else', 'true', 'false', 'null']);

function lexExpression(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? '';
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(source.slice(i));
      const text = m?.[0] ?? c;
      tokens.push({ type: 'num', text });
      i += text.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = source.indexOf(c, i + 1);
      if (end < 0) throw new TemplateError(`Unterminated string at ${String(i)}`);
      tokens.push({ type: 'str', text: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w-]*/.exec(source.slice(i));
      const text = m?.[0] ?? c;
      tokens.push({ type: KEYWORDS.has(text) ? 'op' : 'name', text });
      i += text.length;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op === undefined) throw new TemplateError(`Unexpected "${c}" in expression`);
    tokens.push({ type: 'op', text: op });
    i += op.length;
  }
  tokens.push({ type: 'end', text: '' });
  return tokens;
}

/** Recursive descent, lowest precedence first: conditional → or → and → not → comparison → sum → unary → postfix. */
class ExpressionParser {
  readonly #tokens: Token[];
  #pos = 0;
  /** Inside a filter's arguments `|` belongs to the outer chain, unless parentheses reopen it. */
  #argDepth = 0;

  constructor(source: string) {
    this.#tokens = lexExpression(source);
  }

  static parse(source: string): Expr {
    const parser = new ExpressionParser(source);
    const expr = parser.#conditional();
    if (parser.#peek().type !== 'end') throw new TemplateError(`Unexpected "${parser.#peek().text}" in expression`);
    return expr;
  }

  #peek(): Token {
    return this.#tokens[this.#pos] ?? { type: 'end', text: '' };
  }

  #take(): Token {
    const token = this.#peek();
    this.#pos += 1;
    return token;
  }

  #accept(text: string): boolean {
    if (this.#peek().type === 'op' && this.#peek().text === text) {
      this.#pos += 1;
      return true;
    }
    return false;
  }

  #expect(text: string): void {
    if (!this.#accept(text)) throw new TemplateError(`Expected "${text}" but found "${this.#peek().text || 'end'}"`);
  }

  #conditional(): Expr {
    const first = this.#or();
    if (this.#accept('?')) {
      const then = this.#conditional();
      this.#expect(':');
      return { kind: 'cond', test: first, then, otherwise: this.#conditional() };
    }
    if (this.#accept('if')) {
      const test = this.#or();
      this.#expect('else');
      return { kind: 'cond', test, then: first, otherwise: this.#conditional() };
    }
    return first;
  }

  #or(): Expr {
    let left = this.#and();
    while (this.#accept('or') || this.#accept('||')) left = { kind: 'binary', op: 'or', left, right: this.#and() };
    return left;
  }

  #and(): Expr {
    let left = this.#not();
    while (this.#accept('and') || this.#accept('&&')) left = { kind: 'binary', op: 'and', left, right: this.#not() };
    return left;
  }

  #not(): Expr {
    if (this.#accept('not') || this.#accept('!')) return { kind: 'unary', op: 'not', operand: this.#not() };
    return this.#comparison();
  }

  #comparison(): Expr {
    const left = this.#sum();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.#accept(op)) return { kind: 'binary', op, left, right: this.#sum() };
    }
    return left;
  }

  #sum(): Expr {
    let left = this.#unary();
    for (;;) {
      if (this.#accept('+')) left = { kind: 'binary', op: '+', left, right: this.#unary() };
      else if (this.#accept('-')) left = { kind: 'binary', op: '-', left, right: this.#unary() };
      else return left;
    }
  }

  #unary(): Expr {
    if (this.#accept('-')) return { kind: 'unary', op: 'neg', operand: this.#unary() };
    return this.#postfix();
  }

  #postfix(): Expr {
    let expr = this.#primary();
    for (;;) {
      if (this.#accept('.')) {
        const name = this.#take();
        if (name.type !== 'name') throw new TemplateError('Expected a name after "."');
        expr = expr.kind === 'name' ? { kind: 'name', path: [...expr.path, name.text] } : { kind: 'filter', name: 'get', input: expr, args: [{ kind: 'literal', value: name.text }] };
      } else if (this.#argDepth === 0 && this.#accept('|')) {
        expr = this.#filter(expr);
      } else {
        return expr;
      }
    }
  }

  #filter(input: Expr): Expr {
    const name = this.#take();
    if (name.type !== 'name') throw new TemplateError('Expected a filter name after "|"');
    const args: Expr[] = [];
    if (this.#accept(':') || this.#accept('(')) {
      const parenthesised = this.#tokens[this.#pos - 1]?.text === '(';
      if (!(parenthesised && this.#accept(')'))) {
        this.#argDepth += 1;
        do args.push(this.#conditional()); while (this.#accept(','));
        this.#argDepth -= 1;
        if (parenthesised) this.#expect(')');
      }
    }
    return { kind: 'filter', name: name.text, input, args };
  }

  #primary(): Expr {
    const token = this.#take();
    switch (token.type) {
      case 'num': return { kind: 'literal', value: Number(token.text) };
      case 'str': return { kind: 'literal', value: token.text };
      case 'name': return { kind: 'name', path: [token.text] };
      case 'op':
        if (token.text === '(') {
          const outerDepth = this.#argDepth;
          this.#argDepth = 0;
          const inner = this.#conditional();
          this.#argDepth = outerDepth;
          this.#expect(')');
          return inner;
        }
        if (token.text === 'true') return { kind: 'literal', value: true };
        if (token.text === 'false') return { kind: 'literal', value: false };
        if (token.text === 'null') return { kind: 'literal', value: null };
        throw new TemplateError(`Unexpected "${token.text}" in expression`);
      case 'end':
        throw new TemplateError('Unexpected end of expression');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Evaluation

function isRecord(value: TemplateValue): value is Readonly<Record<string, TemplateValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Jinja truthiness: empty string, 0, false, null, undefined and empty arrays are false. */
export function truthy(value: TemplateValue): boolean {
  if (value === undefined || value === null || value === false || value === '' || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** How a value prints. Nothing for null/undefined, arrays joined with ", ". */
export function stringify(value: TemplateValue): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (isRecord(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : (value ? 'true' : 'false');
}

type Filter = (input: TemplateValue, args: readonly TemplateValue[]) => TemplateValue;

const FILTERS: Readonly<Record<string, Filter>> = {
  upper: (v) => stringify(v).toUpperCase(),
  lower: (v) => stringify(v).toLowerCase(),
  capitalize: (v) => { const s = stringify(v); return s.charAt(0).toUpperCase() + s.slice(1); },
  trim: (v) => stringify(v).trim(),
  length: (v) => (Array.isArray(v) ? v.length : stringify(v).length),
  default: (v, [fallback]) => (truthy(v) ? v : fallback),
  yesno: (v, [yes = 'Yes', no = 'No', unknown]) => (v === undefined || v === null ? (unknown ?? no) : (truthy(v) ? yes : no)),
  join: (v, [sep = ', ']) => (Array.isArray(v) ? v.map(stringify).join(stringify(sep)) : stringify(v)),
  replace: (v, [from, to]) => stringify(v).split(stringify(from)).join(stringify(to)),
  truncate: (v, [n = 50, tail = '…']) => { const s = stringify(v); const max = Number(n); return s.length > max ? s.slice(0, max) + stringify(tail) : s; },
  get: (v, [key]) => (isRecord(v) && Object.hasOwn(v, stringify(key)) ? v[stringify(key)] : undefined),
};

function lookup(values: TemplateValues, path: readonly string[]): TemplateValue {
  let current: TemplateValue = values;
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function compare(op: string, left: TemplateValue, right: TemplateValue): boolean {
  if (op === '==') return left === right || stringify(left) === stringify(right) && left !== undefined && right !== undefined;
  if (op === '!=') return !compare('==', left, right);
  const a = typeof left === 'number' ? left : Number(stringify(left));
  const b = typeof right === 'number' ? right : Number(stringify(right));
  const [x, y] = Number.isNaN(a) || Number.isNaN(b) ? [stringify(left), stringify(right)] : [a, b];
  if (op === '<') return x < y;
  if (op === '<=') return x <= y;
  if (op === '>') return x > y;
  return x >= y;
}

function evaluate(expr: Expr, values: TemplateValues): TemplateValue {
  switch (expr.kind) {
    case 'literal': return expr.value;
    case 'name': return lookup(values, expr.path);
    case 'unary': {
      const v = evaluate(expr.operand, values);
      return expr.op === 'not' ? !truthy(v) : -Number(stringify(v));
    }
    case 'cond': return truthy(evaluate(expr.test, values)) ? evaluate(expr.then, values) : evaluate(expr.otherwise, values);
    case 'filter': {
      const filter = FILTERS[expr.name];
      if (filter === undefined) throw new TemplateError(`Unknown filter "${expr.name}"`);
      return filter(evaluate(expr.input, values), expr.args.map((arg) => evaluate(arg, values)));
    }
    case 'binary': return evaluateBinary(expr, values);
  }
}

function evaluateBinary(expr: Extract<Expr, { kind: 'binary' }>, values: TemplateValues): TemplateValue {
  if (expr.op === 'and') { const l = evaluate(expr.left, values); return truthy(l) ? evaluate(expr.right, values) : l; }
  if (expr.op === 'or') { const l = evaluate(expr.left, values); return truthy(l) ? l : evaluate(expr.right, values); }
  const left = evaluate(expr.left, values);
  const right = evaluate(expr.right, values);
  if (expr.op === '+') return typeof left === 'number' && typeof right === 'number' ? left + right : stringify(left) + stringify(right);
  if (expr.op === '-') return Number(stringify(left)) - Number(stringify(right));
  return compare(expr.op, left, right);
}

// ---------------------------------------------------------------------------------------------
// Template structure

type Node =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'output'; readonly expr: Expr }
  | { readonly kind: 'if'; readonly branches: readonly { readonly test: Expr | undefined; readonly body: readonly Node[] }[] };

const TAG = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}|\{([A-Za-z_][\w.-]*)\}/g;

interface RawTag {
  readonly kind: 'text' | 'output' | 'block';
  readonly text: string;
}

function splitTemplate(template: string): RawTag[] {
  const parts: RawTag[] = [];
  let last = 0;
  for (const match of template.matchAll(TAG)) {
    const at = match.index;
    if (at > last) parts.push(textPart(template.slice(last, at)));
    const [whole, output, block, simple] = match;
    if (output !== undefined) parts.push({ kind: 'output', text: output.trim() });
    else if (block !== undefined) parts.push({ kind: 'block', text: block.trim() });
    else parts.push({ kind: 'output', text: simple ?? '' });
    last = at + whole.length;
  }
  if (last < template.length) parts.push(textPart(template.slice(last)));
  return parts;
}

/** Literal text; a tag opener left in it means a tag that never closed. */
function textPart(text: string): RawTag {
  if (text.includes('{{') || text.includes('{%')) throw new TemplateError('A "{{" or "{%" tag is not closed');
  return { kind: 'text', text };
}

class TemplateParser {
  readonly #parts: RawTag[];
  #pos = 0;

  constructor(template: string) {
    this.#parts = splitTemplate(template);
  }

  static parse(template: string): Node[] {
    const parser = new TemplateParser(template);
    const nodes = parser.#body(false);
    if (parser.#pos < parser.#parts.length) throw new TemplateError('Unexpected "{% endif %}" without an "{% if %}"');
    return nodes;
  }

  /** Reads nodes until a block tag that belongs to the enclosing `if`, which is left for it. */
  #body(inIf: boolean): Node[] {
    const nodes: Node[] = [];
    while (this.#pos < this.#parts.length) {
      const part = this.#parts[this.#pos];
      if (part === undefined) break;
      if (part.kind === 'text') { nodes.push({ kind: 'text', text: part.text }); this.#pos += 1; continue; }
      if (part.kind === 'output') { nodes.push({ kind: 'output', expr: ExpressionParser.parse(part.text) }); this.#pos += 1; continue; }
      const [word] = part.text.split(/\s+/, 1);
      if (word === 'if') { this.#pos += 1; nodes.push(this.#ifBlock(part.text.slice(2))); continue; }
      if (inIf && (word === 'elif' || word === 'elseif' || word === 'else' || word === 'endif')) return nodes;
      throw new TemplateError(`Unknown block "{% ${part.text} %}"`);
    }
    if (inIf) throw new TemplateError('Missing "{% endif %}"');
    return nodes;
  }

  #ifBlock(firstTest: string): Node {
    const branches: { test: Expr | undefined; body: Node[] }[] = [{ test: ExpressionParser.parse(firstTest), body: this.#body(true) }];
    for (;;) {
      const tag = this.#parts[this.#pos];
      if (tag === undefined) throw new TemplateError('Missing "{% endif %}"');
      this.#pos += 1;
      const [word] = tag.text.split(/\s+/, 1);
      if (word === 'endif') return { kind: 'if', branches };
      const test = word === 'else' ? undefined : ExpressionParser.parse(tag.text.slice(word?.length ?? 0));
      branches.push({ test, body: this.#body(true) });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering

/** One rendered piece, with whether it came from a placeholder and whether it said anything. */
interface Chunk {
  readonly text: string;
  readonly placeholder: boolean;
}

function renderNodes(nodes: readonly Node[], values: TemplateValues, out: Chunk[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push({ text: node.text, placeholder: false });
    } else if (node.kind === 'output') {
      out.push({ text: stringify(evaluate(node.expr, values)), placeholder: true });
    } else {
      const branch = node.branches.find((b) => b.test === undefined || truthy(evaluate(b.test, values)));
      if (branch !== undefined) renderNodes(branch.body, values, out);
    }
  }
}

/** Joins chunks into lines, dropping a line whose placeholders were all empty. */
function assemble(chunks: readonly Chunk[], dropEmpty: boolean): string {
  const lines: string[] = [];
  let line = '';
  let placeholders = 0;
  let filled = 0;
  const flush = (): void => {
    if (!(dropEmpty && placeholders > 0 && filled === 0)) lines.push(line);
    line = '';
    placeholders = 0;
    filled = 0;
  };
  for (const chunk of chunks) {
    const pieces = chunk.text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) flush();
      line += piece;
      if (chunk.placeholder && index === pieces.length - 1) {
        placeholders += 1;
        if (piece !== '') filled += 1;
      }
    });
  }
  flush();
  return lines.join('\n');
}

/**
 * Renders `template` with `values`.
 *
 * @throws {TemplateError} when the template does not parse or names an unknown filter. A
 * missing value is never an error: it renders empty.
 */
export function renderTemplate(template: string, values: TemplateValues, options: RenderOptions = {}): string {
  const chunks: Chunk[] = [];
  renderNodes(TemplateParser.parse(template), values, chunks);
  return assemble(chunks, options.dropEmptyLines ?? true);
}

/** Parses without rendering, so a settings page can report a broken template as it is typed. */
export function validateTemplate(template: string): TemplateError | undefined {
  try {
    TemplateParser.parse(template);
    return undefined;
  } catch (error) {
    return error instanceof TemplateError ? error : new TemplateError(String(error));
  }
}

/** The names a template reads, in order of first appearance. Dotted paths report their root. */
export function templatePlaceholders(template: string): readonly string[] {
  const seen = new Set<string>();
  const visit = (expr: Expr): void => {
    switch (expr.kind) {
      case 'name': { const root = expr.path[0]; if (root !== undefined) seen.add(root); return; }
      case 'unary': visit(expr.operand); return;
      case 'binary': visit(expr.left); visit(expr.right); return;
      case 'cond': visit(expr.test); visit(expr.then); visit(expr.otherwise); return;
      case 'filter': visit(expr.input); expr.args.forEach(visit); return;
      case 'literal': return;
    }
  };
  const visitBranch = (branch: { readonly test: Expr | undefined; readonly body: readonly Node[] }): void => {
    if (branch.test !== undefined) visit(branch.test);
    walk(branch.body);
  };
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.kind === 'output') visit(node.expr);
      if (node.kind === 'if') node.branches.forEach(visitBranch);
    }
  };
  walk(TemplateParser.parse(template));
  return [...seen];
}
