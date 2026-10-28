import { afterEach, describe, expect, it } from 'vitest';
import type { StickyElement } from '@freero/shared';
import { createTestBoard, richTextToPlain, type ElementDefinition, type TestBoard } from '@engine';
import { boardSources, commentSources, replaceMatches, search, type Source } from './lib/search';

const src = (key: string, text: string): Source => ({ kind: 'element', key, id: key, type: 'sticky', text, frameTitle: null });
const feature = (name: string, elements: ElementDefinition<any>[], more: Record<string, unknown> = {}) => ({
  manifest: { name, description: '', ...more },
  elements,
  tools: [],
  formats: [],
  panels: [],
  commands: [],
});

describe('search', () => {
  it('counts every occurrence, ignores case unless asked, and snippets around the first one', () => {
    const long = `${'x'.repeat(80)} Budget review: budget, BUDGET`;
    const [m] = search([src('a', long), src('b', 'nothing here')], 'budget');
    expect(m.count).toBe(3);
    expect(m.snippet.hit).toBe('Budget');
    expect(m.snippet.before.startsWith('…')).toBe(true);
    expect(search([src('a', long)], 'budget', { caseSensitive: true })[0].count).toBe(1);
    expect(search([src('a', long)], '   ')).toEqual([]);
  });

  it('finds comments that still exist, never deleted messages or messages of deleted threads', () => {
    const entries: Array<[string, unknown]> = [
      ['t:t1', { kind: 'thread', id: 't1', x: 5, y: 6, createdAt: 0, createdBy: 'u' }],
      ['m:t1:m1', { kind: 'message', threadId: 't1', id: 'm1', authorId: 'u', authorName: 'Ann', text: 'ship it', createdAt: 0 }],
      ['m:t1:m2', { kind: 'message', threadId: 't1', id: 'm2', authorId: 'u', authorName: 'Bob', text: 'ship later', createdAt: 0 }],
      ['x:t1:m2', { kind: 'deleted', threadId: 't1', messageId: 'm2', by: 'u', at: 1 }],
      ['t:t2', { kind: 'thread', id: 't2', x: 0, y: 0, createdAt: 0, createdBy: 'u' }],
      ['m:t2:m1', { kind: 'message', threadId: 't2', id: 'm1', authorId: 'u', authorName: 'Cy', text: 'ship now', createdAt: 0 }],
      ['x:t2', { kind: 'deleted', threadId: 't2', by: 'u', at: 1 }],
    ];
    const hits = search(commentSources(entries, () => undefined), 'ship');
    expect(hits.map((h) => h.source.kind === 'comment' && h.source.author)).toEqual(['Ann']);
  });
});

describe('replace', () => {
  let board: TestBoard;
  afterEach(() => board?.destroy());

  const sticky: ElementDefinition<'sticky'> = {
    type: 'sticky',
    Component: () => null,
    resize: 'free',
    textField: 'text',
    toPlainText: (el) => richTextToPlain(el.text),
    defaults: () => ({ type: 'sticky', w: 100, h: 100, color: 'yellow', text: '', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle' }),
  };

  it('replace all keeps formatting, skips locked items, and is one undo step', () => {
    board = createTestBoard({
      users: ['ann'],
      features: [feature('find', [sticky as ElementDefinition<any>])],
    });
    const [ed] = board.editors('find');
    const textOf = (id: string) => ed.getElement<StickyElement>(id)!.text;
    const [a, b, locked] = ed.createMany([
      { type: 'sticky', x: 0, y: 0, text: '<b>Q3</b> plan' },
      { type: 'sticky', x: 200, y: 0, text: 'q3 risks' },
      { type: 'sticky', x: 400, y: 0, text: 'Q3 locked', locked: true },
    ] as never);
    const matches = search(boardSources(ed, ed.getElements(), []), 'q3');
    expect(matches).toHaveLength(3);
    expect(replaceMatches(ed, matches, 'q3', 'Q4').changed).toBe(2);
    expect(textOf(a)).toBe('<b>Q4</b> plan');
    expect(textOf(b)).toBe('Q4 risks');
    expect(textOf(locked)).toBe('Q3 locked');
    ed.undo();
    expect(textOf(a)).toBe('<b>Q3</b> plan');
    expect(textOf(b)).toBe('q3 risks');
  });

  // A multi-text item whose parts live in its own feature's collection (like table cells).
  const grid: ElementDefinition<'table'> = {
    type: 'table',
    Component: () => null,
    resize: 'free',
    defaults: () => ({ type: 'table', w: 100, h: 100, rows: [{ id: 'r', h: 40 }], cols: [{ id: 'a', w: 50 }, { id: 'b', w: 50 }], header: false, fontSize: 14 }),
    textParts: (el, editor) =>
      el.cols.flatMap((c) => {
        const html = editor.collection<string>('cells').get(`${el.id}:${c.id}`);
        return html ? [{ part: c.id, html }] : [];
      }),
    writeTextPart: (el, part, html, editor) => editor.collection<string>('cells').set(`${el.id}:${part}`, html),
  };

  it('replace all reaches every part of a multi-text item (written by its owner) and words split by formatting, as one undo step', () => {
    board = createTestBoard({
      users: ['ann'],
      features: [
        feature('find', [sticky as ElementDefinition<any>]),
        feature('grid', [grid as ElementDefinition<any>], { owns: ['cells'], undoable: ['cells'] }),
      ],
    });
    const [ed] = board.editors('find');
    const [owner] = board.editors('grid');
    const [note] = ed.createMany([{ type: 'sticky', x: 0, y: 0, text: '<b>Hel</b>lo team' }] as never);
    const table = owner.create({ type: 'table', x: 300, y: 0 } as never);
    owner.collection<string>('cells').set(`${table}:a`, 'hello A');
    owner.collection<string>('cells').set(`${table}:b`, 'B says <i>he</i>llo');
    const cell = (c: string) => owner.collection<string>('cells').get(`${table}:${c}`);

    const matches = search(boardSources(ed, ed.getElements(), []), 'hello');
    expect(matches.map((m) => m.count)).toEqual([1, 2]);
    expect(replaceMatches(ed, matches, 'hello', 'Hi').changed).toBe(2);
    expect(ed.getElement<StickyElement>(note)!.text).toBe('<b>Hi</b> team');
    expect([cell('a'), cell('b')]).toEqual(['Hi A', 'B says <i>Hi</i>']);
    ed.undo();
    expect(ed.getElement<StickyElement>(note)!.text).toBe('<b>Hel</b>lo team');
    expect([cell('a'), cell('b')]).toEqual(['hello A', 'B says <i>he</i>llo']);
  });
});
