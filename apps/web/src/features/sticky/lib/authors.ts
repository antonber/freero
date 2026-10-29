// Sticky author labels (KAI-112): a board setting, off by default, that shows in a corner of each
// sticky who wrote it. The setting is the `stickyLabels` collection (key 'authors'), written only
// by this feature; the names come from the board's people lookup (current names, never stored ones).
import { actingFor, ANONYMOUS_NAME, isAnonymousAuthor, type BoardElement, type PrivateModeSession } from '@freero/shared';
import type { Editor, ElementLayer, HostUser } from '@engine';

export const COLLECTION = 'stickyLabels';
const KEY = 'authors';
export const DELETED_USER = 'Deleted user';

export interface AuthorLabels {
  on: boolean;
  /** Who changed it last. */
  by: string;
}

export const authorLabelsOn = (entries: ReadonlyArray<[string, AuthorLabels]> | Map<string, AuthorLabels>): boolean =>
  !!new Map(entries).get(KEY)?.on;

export function setAuthorLabels(editor: Editor, on: boolean): void {
  if (!editor.can('editor')) return;
  editor.collection<AuthorLabels>(COLLECTION).set(KEY, { on, by: editor.user.id });
}

export const authorLabelsShown = (editor: Editor): boolean => !!editor.collection<AuthorLabels>(COLLECTION).get(KEY)?.on;

/** Private mode is running (its `privateMode` collection): every label is hidden, so nobody is named while people write. */
export const privateModeRunning = (entries: ReadonlyArray<[string, PrivateModeSession]>): boolean => entries.some(([, s]) => s?.active);

/**
 * What the label on `el` says, or null for none. Never a name for a private draft (its author is
 * the only one who sees it anyway, and it must not travel into an export or a screenshot), nor
 * while private mode runs; "Deleted user" for an account that no longer exists, never an id;
 * "<app> for <person>" for what an app or agent added; "Anonymous" for a note revealed anonymously
 * from private mode (#44: its author is on no client).
 */
export function authorLabel(
  el: Pick<BoardElement, 'createdBy' | 'createdVia'>,
  ctx: { privateRunning: boolean; layer: ElementLayer | null; people: Record<string, HostUser>; gone: ReadonlySet<string> },
): string | null {
  if (ctx.privateRunning || ctx.layer === 'private' || !el.createdBy) return null;
  if (isAnonymousAuthor(el.createdBy)) return ANONYMOUS_NAME;
  const person = ctx.people[el.createdBy]?.name ?? (ctx.gone.has(el.createdBy) ? DELETED_USER : null);
  if (!person) return null;
  return el.createdVia ? actingFor(el.createdVia, person) : person;
}
