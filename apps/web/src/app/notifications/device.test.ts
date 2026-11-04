// Notifications on this device (#176): only what is new, unread and of a type left on pops up —
// a reload never repeats what was shown, and nothing pops up while the person is looking at Freero.
import { expect, it } from 'vitest';
import type { AppNotification, NotificationType } from '@freero/shared';
import { toShow } from './device';

const n = (id: string, type: NotificationType, createdAt: number, read = false): AppNotification =>
  ({ id, type, createdAt, readAt: read ? createdAt + 1 : null, actor: null, title: id, body: '', link: '/app', boardId: null }) as AppNotification;

it('pops up only new unread items of the types left on, oldest first, and nothing while Freero is in front', () => {
  const inbox = [n('reply', 'comment.reply', 300), n('old', 'comment.mention', 100), n('read', 'comment.mention', 250, true), n('assigned', 'card.assigned', 260), n('mention', 'comment.mention', 280)];
  const prefs = { on: true, off: ['card.assigned' as NotificationType] };
  expect(toShow(inbox, prefs, 200, false).map((x) => x.id)).toEqual(['mention', 'reply']);
  expect(toShow(inbox, prefs, 200, true)).toEqual([]);
  expect(toShow(inbox, { ...prefs, on: false }, 200, false)).toEqual([]);
});
