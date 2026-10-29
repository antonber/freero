// Meeting notes import (#88): exports written the way notes apps write them (samples in
// docs/integrations/meeting-notes/, original content) land as one frame on a real engine board.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { parseMeetingNotes, richTextToPlain, type BoardElement, type CardElement } from '@freero/shared';
import { createTestBoard, type TestBoard } from '@engine';
import manifest from './feature';
import importer from './importer';
import { layoutMeetingNotes, placeMeeting } from './lib/insert';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../docs/integrations/meeting-notes');
const sample = (name: string) => fs.readFileSync(path.join(SAMPLES, name), 'utf8');
const plain = (el: BoardElement) => richTextToPlain(String((el as { text?: string; title?: string }).text ?? (el as { title?: string }).title ?? ''));

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

it('a Granola-style summary lands as one frame — decisions as a cluster, action items as cards with owner and due date, the rest as notes — and one undo takes it all back', () => {
  board = createTestBoard({ users: ['ann'], features: [manifest] });
  const [ed] = board.editors('meeting-notes');
  const report = placeMeeting(ed, layoutMeetingNotes({ text: sample('granola-style.md'), fileName: 'granola-style.md', date: '2026-10-29' }), { x: 0, y: 0 });

  const all = ed.getElements();
  const frame = ed.getElement(report.frameId)!;
  expect(frame.type).toBe('frame');
  expect((frame as { title: string }).title).toBe('Q4 onboarding review');
  // Everything else sits in the frame, inside its bounds.
  for (const el of all.filter((e) => e.id !== frame.id)) {
    expect(el.frameId).toBe(frame.id);
    expect(el.x >= frame.x && el.y >= frame.y && el.x + el.w <= frame.x + frame.w && el.y + el.h <= frame.y + frame.h).toBe(true);
  }

  const cards = all.filter((e): e is CardElement => e.type === 'card');
  const card = (start: string) => cards.find((c) => plain(c).startsWith(start))!;
  expect(cards).toHaveLength(4);
  expect([richTextToPlain(card('Draft the copy').description), card('Draft the copy').dueDate, card('Draft the copy').status]).toEqual(['Owner: Tom', '2026-11-04', 'todo']);
  expect([richTextToPlain(card('Build the flag').description), card('Build the flag').dueDate]).toEqual(['Owner: Lena', '2026-11-06']);
  // "(Owner: Priya, due Friday)" in a meeting on Thursday 29 October: the next day.
  expect([plain(card('Ask support')), richTextToPlain(card('Ask support').description), card('Ask support').dueDate]).toEqual(['Ask support which onboarding questions come up most', 'Owner: Priya', '2026-10-30']);
  expect(card('Share last quarter').status).toBe('done');

  // Decisions: green notes under their title, side by side (the outline reads a cluster).
  const decisionTitle = all.find((e) => e.type === 'text' && plain(e) === 'Decisions')!;
  const decisions = all.filter((e) => e.type === 'sticky' && (e as { color: string }).color === 'green');
  expect(decisions.map(plain)).toEqual(['Ship the three-step first-run flow behind a flag for 20% of new workspaces', 'Drop the video tour from onboarding', 'Keep the template picker, but show six templates instead of twenty']);
  for (const d of decisions) expect(d.y).toBeGreaterThan(decisionTitle.y);
  // A topic's points stay under their topic; a sub-bullet stays with its point.
  expect(all.some((e) => e.type === 'text' && plain(e) === 'Where people drop off')).toBe(true);
  expect(all.some((e) => e.type === 'sticky' && plain(e).includes('slowest screen') && plain(e).includes('scroll past the first row'))).toBe(true);
  // Who was there and when, in the summary note.
  expect(all.some((e) => e.type === 'shape' && plain(e).includes('October 29, 2026') && plain(e).includes('With Priya Raman, Tom Okafor, Lena Fischer'))).toBe(true);

  ed.undo();
  expect(ed.getElements()).toHaveLength(0);
});

it('transcripts read who spoke from WebVTT voices, SRT and Otter-style labels — turns, talk time — and a decision or action said aloud becomes one', () => {
  const vtt = parseMeetingNotes(sample('design-review.vtt'), { format: 'vtt' });
  // Two cues of Ana in a row are one turn; talk time is the sum of her cues (6.5 + 5.5 + 9.5 s).
  expect(vtt.transcript).toEqual({
    speakers: [
      { name: 'Ana Costa', turns: 2, seconds: 22, words: 27 },
      { name: 'Ben Ito', turns: 2, seconds: 15, words: 19 },
      { name: 'Chloé Martin', turns: 1, seconds: 9, words: 8 },
    ],
    turns: 5,
    seconds: 46,
  });
  expect(vtt.decisions).toEqual(['We group frames into collapsible sections.']);
  // "by Friday", said in a call the file's NOTE dates Wednesday 28 October.
  expect(vtt.actions).toEqual([{ text: 'Chloé mocks up the collapsed state.', dueDate: '2026-10-30' }]);

  const srt = parseMeetingNotes(sample('standup.srt'), { format: 'srt' });
  expect(srt.transcript?.speakers.map((s) => [s.name, s.turns, s.seconds])).toEqual([
    ['Omar', 2, 12],
    ['Jess', 1, 7],
  ]);

  const otter = parseMeetingNotes(sample('otter-style.txt'), { format: 'text' });
  expect(otter.title).toBe('Support sync');
  expect(otter.transcript?.speakers.map((s) => [s.name, s.turns, s.seconds])).toEqual([
    ['Rosa Alvarez', 3, null],
    ['Dev Patel', 2, null],
    ['Kim Sato', 1, null],
  ]);
  expect(otter.decisions).toHaveLength(1);
});

it('a plain-text summary with “Title:” and ALL-CAPS headings reads like Markdown, and relative due dates count from the notes’ own date', () => {
  const notes = parseMeetingNotes(sample('meetily-style.txt'), { format: 'text', date: '2026-12-01' });
  expect(notes.title).toBe('Infrastructure weekly - 2026-10-27');
  expect(notes.date).toBe('2026-10-27');
  expect(notes.decisions).toHaveLength(2);
  expect(notes.actions).toEqual([
    { text: 'Fix the alert routing rule', owner: 'Sam', dueDate: '2026-10-28' },
    { text: 'Write a runbook for long migrations', owner: 'Ines' },
    { text: 'Estimate the saving from the storage class change', dueDate: '2026-11-10' },
  ]);
  expect(notes.sections).toEqual([{ title: 'Key points', points: expect.arrayContaining(['Storage costs grew 18% month over month']) }]);
});

it('a dropped caption file becomes a meeting frame, while a dropped Markdown file is left to the importer that owns it', async () => {
  board = createTestBoard({ users: ['ann'], features: [manifest] });
  const [ed] = board.editors('meeting-notes');
  const md = new File([sample('granola-style.md')], 'notes.md', { type: 'text/markdown' });
  expect(await importer.importData(ed, { files: [md], text: null, html: null }, { x: 0, y: 0 })).toBe(false);
  const vtt = new File([sample('design-review.vtt')], 'design-review.vtt', { type: 'text/vtt' });
  expect(await importer.importData(ed, { files: [vtt, md], text: null, html: null }, { x: 0, y: 0 })).toEqual([vtt]);
  await vi.waitFor(() => expect((ed.getElements().find((e) => e.type === 'frame') as { title?: string } | undefined)?.title).toBe('Design review'));
});
