import { describe, expect, it } from 'vitest';
import { chooseLocale } from './locale';

describe('which language a page starts in', () => {
  it('a ?lang= link wins for this tab, over what this browser remembers, and keeps winning while the tab navigates', () => {
    const asked = chooseLocale({ query: 'de-AT', tab: null, stored: 'fr', browser: ['ja'] });
    expect(asked).toEqual({ locale: 'de', fromTab: true });
    // next page in the same tab, no ?lang= any more
    expect(chooseLocale({ query: null, tab: asked.locale, stored: 'fr', browser: ['ja'] })).toEqual({ locale: 'de', fromTab: true });
  });
  it('a ?lang= we don’t ship is ignored rather than falling back to English', () => {
    expect(chooseLocale({ query: 'sv', tab: null, stored: 'fr', browser: [] }).locale).toBe('fr');
  });
  it('without a remembered choice the browser’s languages decide, and nothing shipped means English', () => {
    expect(chooseLocale({ query: null, tab: null, stored: null, browser: ['sv-SE', 'pt-PT'] }).locale).toBe('pt-BR');
    expect(chooseLocale({ query: null, tab: null, stored: 'xx', browser: ['sv'] }).locale).toBe('en');
  });
});
