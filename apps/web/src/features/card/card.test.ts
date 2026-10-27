import { describe, expect, it } from 'vitest';
import type { StickyElement } from '@freero/shared';
import { createTestBoard } from '@engine';
import manifest from './feature';
import { cardFromSticky, isOverdue } from './lib/actions';
import { cardLayout } from './lib/layout';
import { boardPeople, refreshMembers, resolvePerson } from './lib/people';

describe('due dates', () => {
  it('treats the due date as a local calendar day: due today is never overdue, even late at night', () => {
    // A UTC-parsed date would flip these in time zones west/east of UTC.
    expect(isOverdue('2026-10-27', 'todo', new Date(2026, 9, 27, 23, 59))).toBe(false);
    expect(isOverdue('2026-10-27', 'todo', new Date(2026, 9, 27, 0, 1))).toBe(false);
    expect(isOverdue('2026-10-27', 'doing', new Date(2026, 9, 28, 0, 1))).toBe(true);
    expect(isOverdue('2026-10-20', 'done', new Date(2026, 9, 28))).toBe(false);
  });
});

describe('card height follows its content', () => {
  it('grows for a wrapping title and a description instead of clipping them', () => {
    const empty = cardLayout({ w: 300, title: '', description: '' });
    const longTitle = cardLayout({ w: 300, title: 'Migrate the billing service to the new event bus and backfill invoices', description: '' });
    const withDesc = cardLayout({ w: 300, title: 'Short', description: 'Line one<br>Line two' });
    expect(longTitle.titleLines).toBeGreaterThan(1);
    expect(longTitle.h).toBeGreaterThan(empty.h);
    expect(withDesc.h).toBeGreaterThan(empty.h);
    // Narrower card → more wrapping → taller.
    expect(cardLayout({ w: 200, title: 'Migrate the billing service to the new event bus', description: '' }).h).toBeGreaterThan(
      cardLayout({ w: 400, title: 'Migrate the billing service to the new event bus', description: '' }).h,
    );
  });
});

describe('convert sticky to card', () => {
  it('keeps the first line as title, the rest as description, the tags, and the sticky’s center', () => {
    const sticky = {
      id: 's1',
      type: 'sticky',
      x: 100,
      y: 200,
      w: 200,
      h: 200,
      rotation: 0,
      z: 1,
      createdBy: 'u',
      createdAt: 0,
      updatedAt: 0,
      color: 'blue',
      text: '<br>Ship <b>onboarding</b> v2<br>Needs copy review<br>and QA',
      tags: ['t1'],
      fontFamily: 'sans',
      fontSize: 'auto',
      textColor: '#000',
      align: 'center',
      vAlign: 'middle',
      frameId: 'f1',
    } as StickyElement;
    const card = cardFromSticky(sticky);
    expect(card.title).toBe('Ship onboarding v2');
    expect(card.description).toBe('Needs copy review<br>and QA');
    expect(card.tags).toEqual(['t1']);
    expect(card.frameId).toBe('f1');
    expect(Math.abs(card.x + card.w / 2 - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.y + card.h / 2 - 300)).toBeLessThanOrEqual(1);
  });
});

describe('assignees', () => {
  it('resolves and offers a board member who has never been online here, from the member directory', async () => {
    const ann = { id: 'ann', name: 'Ann', color: '#e5484d', avatarUrl: null };
    const bob = { id: 'bob', name: 'Bob', color: '#1fa463', avatarUrl: null };
    const board = createTestBoard({ users: [ann], members: [ann, bob], features: [manifest] });
    try {
      const [editor] = board.editors('card');
      await refreshMembers(editor);
      expect(resolvePerson(editor, 'bob')).toMatchObject({ name: 'Bob', color: '#1fa463', online: false });
      expect(boardPeople(editor).map((p) => p.id)).toEqual(['ann', 'bob']);
    } finally {
      board.destroy();
    }
  });
});
