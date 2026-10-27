// Card helpers shared by the tool, element, format toolbar and commands.
import type { CardElement, StickyElement } from '@freero/shared';
import { plainToRichText, richTextToPlain, type Editor, type NewElement, type Point } from '@engine';
import { CARD_W, cardLayout } from './layout';
import { DEFAULT_ACCENT, STICKY_ACCENT, TOOL_ID, type CardToolOptions } from './constants';

/** A new card centered on `at`, using the last chosen accent. */
export function cardAt(editor: Editor, at: Point, overrides: Partial<CardElement> = {}): NewElement<'card'> {
  const color = editor.getToolOptions<CardToolOptions>(TOOL_ID).color ?? DEFAULT_ACCENT;
  const base = { title: '', description: '', w: CARD_W, ...overrides };
  const { h } = cardLayout(base);
  return {
    type: 'card',
    color,
    status: 'todo',
    assigneeId: null,
    dueDate: null,
    tags: [],
    ...base,
    x: Math.round(at.x - base.w / 2),
    y: Math.round(at.y - h / 2),
    h,
  };
}

/**
 * A card carrying a sticky's content: first line → title, the rest → description; same center,
 * frame, group and tags, accent from the sticky's paper color.
 */
export function cardFromSticky(s: StickyElement): NewElement<'card'> {
  const lines = richTextToPlain(s.text).split('\n');
  const first = lines.findIndex((l) => l.trim());
  const title = first >= 0 ? lines[first].trim() : '';
  const rest = first >= 0 ? lines.slice(first + 1).join('\n').trim() : '';
  const fields = { title: plainToRichText(title), description: plainToRichText(rest), w: CARD_W };
  const { h } = cardLayout(fields);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return {
    type: 'card',
    ...fields,
    h,
    x: Math.round(cx - CARD_W / 2),
    y: Math.round(cy - h / 2),
    color: STICKY_ACCENT[s.color] ?? DEFAULT_ACCENT,
    status: 'todo',
    assigneeId: null,
    dueDate: null,
    tags: s.tags?.length ? [...s.tags] : [],
    frameId: s.frameId ?? null,
    groupId: s.groupId ?? null,
  };
}

export const selectedStickies = (editor: Editor): StickyElement[] =>
  editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is StickyElement => el?.type === 'sticky' && !el.locked);

/** Replaces each selected sticky with a card, in one undo step. */
export function convertStickiesToCards(editor: Editor) {
  const stickies = selectedStickies(editor);
  if (!stickies.length) return;
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(stickies.map(cardFromSticky));
    editor.remove(stickies.map((s) => s.id));
  });
  if (ids.length) editor.select(ids);
}

// ---- due dates. Stored as a local calendar date 'YYYY-MM-DD' (no time zone).

export function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Past its due day and not done. A card due today is not overdue yet. */
export function isOverdue(due: string | null | undefined, status: CardElement['status'], now: Date): boolean {
  if (!due || status === 'done') return false;
  return due < localISODate(now);
}

export function formatDue(due: string, now: Date): string {
  const [y, m, d] = due.split('-').map(Number);
  if (!y || !m || !d) return due;
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(y !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
