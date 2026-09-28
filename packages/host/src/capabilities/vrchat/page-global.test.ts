import { afterEach, describe, expect, it } from 'vitest';

import { pageGlobal } from './page-global.js';

const scope = globalThis as Record<string, unknown>;

afterEach(() => { delete scope['vrcnxTestGlobal']; });

describe('pageGlobal', () => {
  it('reads a global the page put on window', () => {
    scope['vrcnxTestGlobal'] = { id: 'usr_1' };
    expect(pageGlobal('vrcnxTestGlobal')).toEqual({ id: 'usr_1' });
  });

  it('is undefined for a name nothing declared, rather than throwing', () => {
    expect(pageGlobal('vrcnxNeverDeclared')).toBeUndefined();
  });

  it('refuses a name that is not an identifier', () => {
    expect(pageGlobal('1 + 1')).toBeUndefined();
    expect(pageGlobal('a; sideEffect()')).toBeUndefined();
  });
});
