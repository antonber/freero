// @vitest-environment jsdom
// The guided retro with the features it drives (state-machine audit FAC-1, FAC-4), as the app loads
// them, on real replicas, through its own dialog and step bar: a finished retro stays finished, and
// the retro acts only on the vote and the private mode it started itself.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { liveSession } from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import { features } from './features';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let board: TestBoard | null = null;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  board?.destroy();
  board = null;
  document.body.innerHTML = '';
});

/** Replica `user`'s panel `id`, mounted; its buttons are found by their label. */
function mount(user: number, id: string): (label: string) => HTMLButtonElement | undefined {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(board!.panel(user, id)));
  return (label) => [...host.querySelectorAll('button'), ...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined;
}
const click = (b: HTMLButtonElement | undefined) => {
  expect(b).toBeDefined();
  act(() => void b!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
};
const session = (e: Editor, collection: string, key = 'session') => liveSession((k) => e.collection<unknown>(collection).get(k), key) as Record<string, unknown> | undefined;
const retro = (e: Editor) => session(e, 'retro');
const vote = (e: Editor) => session(e, 'voting');

/** Starts a retro from its dialog as replica `user`. */
const startRetro = (user: number) => click(mount(user, 'retro.start')('Start writing'));

it('a finished retro stays finished when a participant adds an action item at the same moment', () => {
  board = createTestBoard({ users: ['ann', 'bob'], roles: ['owner', 'editor'], features });
  const [ann, bob] = board.editors();
  startRetro(0);
  const annBar = mount(0, 'retro.bar');
  for (const next of ['Reveal and group', 'Start voting', 'Show results', 'Agree on actions']) click(annBar(next));
  board.sync();
  const bobBar = mount(1, 'retro.bar');

  click(annBar('Finish retro'));
  click(bobBar('Add action item')); // before he hears of it
  board.sync();

  expect(retro(ann)).toBeUndefined();
  expect(retro(bob)).toBeUndefined();
});

it('a double click on the step button moves the retro one step, not two', () => {
  board = createTestBoard({ users: ['ann'], features });
  const [ann] = board.editors();
  startRetro(0);
  const bar = mount(0, 'retro.bar');

  // A browser's double click: two clicks (detail 1, then 2) on whatever is under the pointer —
  // the second lands on "Start voting", which took "Reveal and group"'s place.
  act(() => void bar('Reveal and group')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  act(() => void bar('Start voting')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));

  expect(retro(ann)?.phase).toBe('group');
  expect(vote(ann)).toBeUndefined();
});

it("the retro's vote step never adopts a vote that is still open: it waits until that one is ended, then runs its own", () => {
  board = createTestBoard({ users: ['ann'], features });
  const [ann] = board.editors();
  ann.runCommand('voting.start', { votesPerUser: 1, title: 'Offsite venue' });
  startRetro(0);
  const bar = mount(0, 'retro.bar');
  click(bar('Reveal and group'));

  click(bar('Start voting')); // while "Offsite venue" is still open
  expect(retro(ann)?.phase).toBe('group');
  expect(vote(ann)).toMatchObject({ title: 'Offsite venue', active: true });

  ann.runCommand('voting.end');
  click(bar('Start voting'));
  expect(retro(ann)?.phase).toBe('vote');
  expect(vote(ann)).toMatchObject({ title: 'What should we talk about?', active: true });
});

it("moving on from the vote step ends only the retro's own vote, not one someone started after ending it", () => {
  board = createTestBoard({ users: ['ann'], features });
  const [ann] = board.editors();
  startRetro(0);
  const bar = mount(0, 'retro.bar');
  click(bar('Reveal and group'));
  click(bar('Start voting'));
  ann.runCommand('voting.end'); // someone ends the retro's vote from the board menu…
  ann.runCommand('voting.start', { votesPerUser: 1, title: 'Offsite venue' }); // …and runs their own

  click(bar('Show results'));

  expect(vote(ann)).toMatchObject({ title: 'Offsite venue', active: true });
});

it("a retro started while someone's private mode runs doesn't take it over (its group step would reveal and end it)", () => {
  board = createTestBoard({ users: ['ann', 'bob'], features });
  const [ann, bob] = board.editors();
  bob.runCommand('private-mode.start');
  board.sync();

  startRetro(0);

  expect(retro(ann)).toBeUndefined();
  expect(session(ann, 'privateMode')).toMatchObject({ active: true, startedBy: 'bob' });
});
