// Board layers on the client: content that must not reach everyone (hidden frames' contents,
// private-mode drafts) is never written to the shared doc, and undo still treats each user action
// as one step even when it spans the shared doc and a layer doc.
import { afterEach, describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { publicCursor } from '../editor/layers';
import { boxDef, bundle, frameDef, makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

const hidingFrame: ElementDefinition<'frame'> = { ...frameDef, hidesContents: (f) => !!f.hidden };
const setup = (role: 'owner' | 'viewer' = 'owner') =>
  makeCore({ role, bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, hidingFrame as ElementDefinition<any>] })] });

/** Every element id ever written to the SHARED doc (what the server would relay to everyone). */
function sharedWrites(c: EngineCore): Set<string> {
  const seen = new Set<string>();
  c.store.elements.observe((ev) => ev.keysChanged.forEach((k) => seen.add(k)));
  return seen;
}

const settle = () => new Promise<void>((r) => queueMicrotask(r));
const sticky = (x: number, y: number) => ({ type: 'sticky', x, y }) as never;

describe('hidden frames', () => {
  it('a sticky created inside a hidden frame never touches the shared doc, yet its editor sees it', () => {
    core = setup();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
    const shared = sharedWrites(core);
    const id = core.editor.create(sticky(100, 100));
    expect(shared.has(id)).toBe(false);
    expect(core.editor.layerOf(id)).toBe('editors');
    expect(core.editor.getElement(id)?.frameId).toBe(frame);
  });

  it('hiding a frame takes its contents out of the shared doc, and undoing the hide puts them back', async () => {
    core = setup();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0 } as never);
    const id = core.editor.create(sticky(100, 100));
    expect(core.editor.layerOf(id)).toBe('shared');

    core.editor.update(frame, { hidden: true } as never);
    await settle();
    expect(core.store.elements.has(id)).toBe(false);
    expect(core.editor.layerOf(id)).toBe('editors');

    core.editor.undo();
    await settle();
    expect(core.editor.getElement<BoardElement & { hidden?: boolean }>(frame)?.hidden).toBeFalsy();
    expect(core.editor.layerOf(id)).toBe('shared');
  });

  it('dragging a sticky out of a hidden frame is one undo step across both docs', () => {
    core = setup();
    core.editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
    const id = core.editor.create(sticky(100, 100));
    core.editor.moveBy([{ id, dx: 900, dy: 0 }]);
    expect(core.editor.layerOf(id)).toBe('shared');
    expect(core.editor.getElement(id)?.frameId ?? null).toBe(null);

    core.editor.undo();
    expect(core.editor.layerOf(id)).toBe('editors');
    expect(core.editor.getElement(id)).toMatchObject({ x: 100 });
    expect(core.store.elements.has(id)).toBe(false);
  });

  it("a viewer never sees a hidden frame's contents, even while they are still in the shared doc", () => {
    core = setup('viewer');
    // A collaborator's write that has not been moved out yet (arrives as a remote change).
    core.store.doc.transact(() => {
      core.store.elements.set('f', { id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300, z: 0, rotation: 0, hidden: true } as unknown as BoardElement);
      core.store.elements.set('s', { id: 's', type: 'sticky', x: 10, y: 10, w: 100, h: 100, z: 1, rotation: 0, frameId: 'f' } as unknown as BoardElement);
    }, 'remote');
    expect(core.editor.getVisibleElements().map((e) => e.id)).toEqual(['f']);
  });
});

describe('private mode placement', () => {
  it('new matching elements go only to the private layer; existing shared ones stay shared; undo removes a draft', () => {
    core = setup();
    const before = core.editor.create(sticky(0, 0));
    const shared = sharedWrites(core);
    core.editor.setPrivatePlacement((el) => el.type === 'sticky');

    const draft = core.editor.create(sticky(300, 0));
    core.editor.update(draft, { text: 'only mine' } as never);
    core.editor.update(before, { text: 'still shared' } as never);
    expect(shared.has(draft)).toBe(false);
    expect(core.editor.layerOf(draft)).toBe('private');
    expect(core.editor.layerOf(before)).toBe('shared');

    core.editor.undo(); // the edit of `before`
    core.editor.undo(); // the draft's text
    core.editor.undo(); // the draft itself
    expect(core.editor.getElement(draft)).toBeUndefined();
    expect(core.editor.getElement(before)).toBeDefined();
  });
});

describe('private mode across the reveal', () => {
  it("an edit the author made while the server revealed the item is not lost: it replaces the revealed copy", async () => {
    core = setup();
    core.editor.setPrivatePlacement((el) => el.type === 'sticky');
    const id = core.editor.create(sticky(0, 0));
    core.editor.update(id, { text: 'v1' } as never);
    const revealed = core.editor.getElement(id)!;
    core.editor.update(id, { text: 'v2' } as never); // typed on while the reveal was on its way
    // The server's reveal of v1 arrives (its delete of the private copy missed the v2 edit).
    core.store.doc.transact(() => core.store.elements.set(id, revealed), 'remote');
    await settle();
    expect(core.editor.layerOf(id)).toBe('shared');
    expect(core.store.elements.get(id)).toMatchObject({ text: 'v2' });
    expect(core.store.layers.private.elements.has(id)).toBe(false);
  });

  it("others never learn where the author drafts: no private ids in presence, no cursor where content goes private", () => {
    core = setup();
    const shared = core.editor.create(sticky(500, 500));
    core.editor.setPrivatePlacement((el) => el.type === 'sticky' && el.x < 300);
    const draft = core.editor.create(sticky(0, 0));
    core.editor.select([draft, shared]);
    expect(core.store.getLocalPresence().selection).toEqual([shared]);
    expect(publicCursor(core, { x: 50, y: 50 })).toBeNull();
    expect(publicCursor(core, { x: 900, y: 900 })).toEqual({ x: 900, y: 900 });
  });
});

describe('element content follows its element (KAI-230)', () => {
  // Table cells live in the `tableCells` collection, keyed by table id (@freero/shared tableCellKey).
  const withCells = () =>
    makeCore({
      bundles: [
        bundle('boxes', { elements: [boxDef as ElementDefinition<any>, hidingFrame as ElementDefinition<any>] }),
        bundle('table', { manifest: { name: 'table', description: 'cells', owns: ['tableCells'], undoable: ['tableCells'] } }),
      ],
    });
  const cells = () => core.scoped('table').collection<string>('tableCells');
  const cellKey = (id: string) => `t:${id}:r1:c1`;
  const sharedCells = () => core.store.doc.getMap('tableCells');
  /** Every tableCells key ever written to the SHARED doc (what the server relays to everyone). */
  function sharedCellWrites(c: EngineCore): Set<string> {
    const seen = new Set<string>();
    c.store.doc.getMap('tableCells').observe((ev) => ev.keysChanged.forEach((k) => seen.add(k)));
    return seen;
  }

  it("a hidden frame's table keeps its cell text out of the shared doc; dragging it out brings the text along in one undo step", () => {
    core = withCells();
    core.editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
    const shared = sharedCellWrites(core);
    const table = core.editor.create(sticky(100, 100));
    cells().set(cellKey(table), 'salary bands');
    expect(shared.has(cellKey(table))).toBe(false);
    expect(cells().get(cellKey(table))).toBe('salary bands');

    core.editor.moveBy([{ id: table, dx: 900, dy: 0 }]);
    expect(sharedCells().get(cellKey(table))).toBe('salary bands');
    expect(core.store.layers.editors.doc.getMap('tableCells').has(cellKey(table))).toBe(false);

    core.editor.undo();
    expect(core.editor.layerOf(table)).toBe('editors');
    expect(sharedCells().has(cellKey(table))).toBe(false);
    expect(cells().get(cellKey(table))).toBe('salary bands');
  });

  it("hiding a frame takes its table's cells out of the shared doc, and a private draft's cells never enter it", async () => {
    core = withCells();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0 } as never);
    const table = core.editor.create(sticky(100, 100));
    cells().set(cellKey(table), 'roadmap');
    core.editor.update(frame, { hidden: true } as never);
    await settle();
    expect(sharedCells().has(cellKey(table))).toBe(false);
    expect(core.store.layers.editors.doc.getMap('tableCells').get(cellKey(table))).toBe('roadmap');

    const shared = sharedCellWrites(core);
    core.editor.setPrivatePlacement((el) => el.type === 'sticky');
    const draft = core.editor.create(sticky(900, 900));
    cells().set(cellKey(draft), 'my idea');
    await settle();
    expect(shared.has(cellKey(draft))).toBe(false);
    expect(core.store.layers.private.doc.getMap('tableCells').get(cellKey(draft))).toBe('my idea');
  });

  it('a cell a collaborator typed into the shared doc while the table was being hidden is moved into the hidden layer', async () => {
    core = withCells();
    core.editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
    const table = core.editor.create(sticky(100, 100));
    // Their client still saw the table as shared content when they typed.
    core.store.doc.transact(() => sharedCells().set(cellKey(table), 'typed meanwhile'), 'remote');
    await settle();
    expect(sharedCells().has(cellKey(table))).toBe(false);
    expect(cells().get(cellKey(table))).toBe('typed meanwhile');
  });
});

describe('comment threads follow the item they are pinned to (KAI-234)', () => {
  const withComments = () =>
    makeCore({
      bundles: [
        bundle('boxes', { elements: [boxDef as ElementDefinition<any>, hidingFrame as ElementDefinition<any>] }),
        bundle('comments', { manifest: { name: 'comments', description: 'comments', owns: ['comments'] } }),
      ],
    });
  const comments = () => core.scoped('comments').collection<unknown>('comments');
  const sharedComments = () => core.store.doc.getMap('comments');
  const thread = (id: string, elementId: string | null) => ({ kind: 'thread', id, x: 0, y: 0, elementId, corner: elementId ? 'top-right' : null, createdAt: 1, createdBy: 'u1' });
  const message = (threadId: string, id: string, text: string) => ({ kind: 'message', threadId, id, authorId: 'u1', authorName: 'Tester', text, createdAt: 1 });

  it("a discussion of an item in a hidden frame never touches the shared doc; showing the frame brings it to everyone; a board-level thread stays shared", async () => {
    core = withComments();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
    const item = core.editor.create(sticky(100, 100));
    const written = new Set<string>();
    sharedComments().observe((ev) => ev.keysChanged.forEach((k) => written.add(k)));
    core.editor.transact(() => {
      comments().set('t:h1', thread('h1', item));
      comments().set('m:h1:m1', message('h1', 'm1', 'their numbers are off'));
      comments().set('t:b1', thread('b1', null));
      comments().set('m:b1:m1', message('b1', 'm1', 'welcome'));
    });
    // A reply typed later is routed by its thread record, which names the item.
    comments().set('m:h1:m2', message('h1', 'm2', 'agreed'));
    expect([...written].filter((k) => k.includes(':h1'))).toEqual([]);
    expect(sharedComments().has('m:b1:m1')).toBe(true);
    expect(comments().get('m:h1:m2')).toMatchObject({ text: 'agreed' });

    core.editor.update(frame, { hidden: false } as never);
    await settle();
    for (const k of ['t:h1', 'm:h1:m1', 'm:h1:m2']) expect(sharedComments().has(k)).toBe(true);
    expect(core.store.layers.editors.doc.getMap('comments').size).toBe(0);
  });
});
