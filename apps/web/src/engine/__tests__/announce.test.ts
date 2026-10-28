import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineCore } from '../runtime/core';
import { installAnnouncer } from '../interaction/announce';
import { syncStores } from '../store/replicas';
import { makeCore } from './harness';

const cores: EngineCore[] = [];
const offs: Array<() => void> = [];
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  cores.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

function listen(core: EngineCore) {
  const said = { selection: [] as string[], people: [] as string[] };
  offs.push(installAnnouncer(core, { selection: (m) => said.selection.push(m), people: (m) => said.people.push(m) }));
  return said;
}

describe('screen-reader announcements', () => {
  it('reads a selected note as its type and text, with its place in the keyboard walk and its frame', () => {
    vi.useFakeTimers();
    const core = makeCore();
    cores.push(core);
    const said = listen(core);
    core.editor.create({ type: 'frame', x: 0, y: 0, w: 400, h: 400, title: 'Retro' } as never);
    core.editor.create({ type: 'sticky', x: 20, y: 20 } as never);
    const note = core.editor.create({ type: 'sticky', x: 20, y: 200, text: '<p>Ship  on <b>Friday</b></p>' } as never);
    core.editor.select([note]);
    vi.advanceTimersByTime(200);
    expect(said.selection).toEqual(['Sticky: Ship on Friday. 3 of 3, in Frame: Retro.']);
  });

  it("announces a collaborator's burst of edits once when it settles, at most every 10 s, and never my own edits or undo", () => {
    vi.useFakeTimers();
    const me = makeCore();
    const them = makeCore();
    cores.push(me, them);
    const said = listen(me);
    const sync = () => syncStores([me.store, them.store]);
    vi.advanceTimersByTime(2500); // past the first sync's quiet period

    const mine = me.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    me.editor.update(mine, { x: 40 });
    me.editor.undo();
    sync();
    vi.advanceTimersByTime(15000);
    expect(said.people).toEqual([]);

    const ids = [0, 1, 2].map((i) => them.editor.create({ type: 'sticky', x: 300 + i * 150, y: 0 } as never));
    sync();
    vi.advanceTimersByTime(1000);
    them.editor.update(ids[0], { y: 50 });
    sync();
    vi.advanceTimersByTime(2100);
    expect(said.people).toEqual(['Someone changed 3 items.']);

    them.editor.update(ids[1], { y: 80 });
    sync();
    vi.advanceTimersByTime(5000);
    expect(said.people).toHaveLength(1); // a busy board doesn't talk over the reader
    vi.advanceTimersByTime(5100);
    expect(said.people).toEqual(['Someone changed 3 items.', 'Someone changed Sticky.']);
  });
});
