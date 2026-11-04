import { afterEach, describe, expect, it } from 'vitest';
import { formatMessage, negotiateLocale } from '@freero/shared';
import { defineMessages, installLocale } from './i18n';

describe('plurals follow each language’s rules', () => {
  const votes = '{n, plural, =0 {no votes} zero {zero:#} one {one:#} two {two:#} few {few:#} many {many:#} other {other:#}}';
  it('Arabic picks its two / few / many forms instead of falling back to English one / other', () => {
    expect([2, 3, 11, 100].map((n) => formatMessage('ar', votes, { n }).split(':')[0])).toEqual(['two', 'few', 'many', 'other']);
  });
  it('an exact =0 case wins over the category, and Japanese has no singular', () => {
    expect(formatMessage('ja', votes, { n: 0 })).toBe('no votes');
    expect(formatMessage('ja', votes, { n: 1 })).toBe('other:1');
    expect(formatMessage('en', votes, { n: 1 })).toBe('one:1');
  });
  it('# inside a select nested in a plural still prints the count', () => {
    const m = '{n, plural, one {{who, select, me {You have # vote} other {{who} has # vote}}} other {{who, select, me {You have # votes} other {{who} has # votes}}}}';
    expect(formatMessage('en', m, { n: 3, who: 'Ann' })).toBe('Ann has 3 votes');
    expect(formatMessage('en', m, { n: 1, who: 'me' })).toBe('You have 1 vote');
  });
});

describe('message text survives the formatter', () => {
  it('an apostrophe in prose stays, while quoted braces print literally', () => {
    expect(formatMessage('fr', "L'élément {name} n'existe pas", { name: 'A' })).toBe("L'élément A n'existe pas");
    expect(formatMessage('en', "Type '{name}' or ''quotes''", { name: 'x' })).toBe("Type {name} or 'quotes'");
  });
  it('a broken translation shows as written instead of breaking the page', () => {
    expect(() => formatMessage('de', 'Hallo {name', { name: 'A' })).not.toThrow();
    expect(formatMessage('de', 'Hallo {name', { name: 'A' })).toBe('Hallo {name');
  });
});

describe('catalogues', () => {
  afterEach(() => installLocale('en'));
  it('a key the language hasn’t translated yet shows its English text, not the key', () => {
    const t = defineMessages('features/demo', { saved: 'Saved', votes: '{count, plural, one {# vote} other {# votes}}' });
    installLocale('de', { 'features/demo': { saved: 'Gespeichert' } });
    expect(t('saved')).toBe('Gespeichert');
    expect(t('votes', { count: 2 })).toBe('2 votes');
  });
  it('a unit never reads another unit’s translation of the same key', () => {
    const a = defineMessages('features/a', { close: 'Close' });
    installLocale('de', { 'features/b': { close: 'Schließen' } });
    expect(a('close')).toBe('Close');
  });
});

describe('negotiating the browser’s languages', () => {
  it('a region we don’t ship falls back to the language, and the shipped region of it', () => {
    expect(negotiateLocale(['de-AT'])).toBe('de');
    expect(negotiateLocale(['pt-PT'])).toBe('pt-BR');
    expect(negotiateLocale(['zh-TW'])).toBe('zh-CN');
    expect(negotiateLocale(['iw'])).toBe('he');
  });
  it('the first language the person lists that we ship wins; none shipped means no match', () => {
    expect(negotiateLocale(['sv-SE', 'fr-CA', 'de'])).toBe('fr');
    expect(negotiateLocale(['sv', 'fi'])).toBeNull();
  });
});
