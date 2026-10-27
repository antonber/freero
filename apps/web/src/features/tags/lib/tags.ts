// Pure tag helpers (unit-tested). Tags live in the board's `tags` collection (owned by this
// feature); elements reference them by id in their `tags` field.
import type { BoardElement, Tag } from '@freero/shared';
import type { ElementPatch } from '@engine';

export type TagPatch = { id: string; patch: ElementPatch };
const tagsPatch = (id: string, tags: string[]): TagPatch => ({ id, patch: { tags } as ElementPatch });

export const TAG_COLORS = ['#5B3FF0', '#2E9BF0', '#14B8A6', '#1FA463', '#84CC16', '#F5A524', '#F97316', '#E5484D', '#E64DA6', '#8A89A3'];

export type Taggable = Extract<BoardElement, { type: 'sticky' | 'card' }>;

export const isTaggable = (el: BoardElement | undefined | null): el is Taggable => el?.type === 'sticky' || el?.type === 'card';

/** 'all' when every element has the tag, 'some' when only part of them do. */
export function tagState(els: Taggable[], tagId: string): 'all' | 'some' | 'none' {
  const n = els.filter((el) => el.tags?.includes(tagId)).length;
  return n === 0 ? 'none' : n === els.length ? 'all' : 'some';
}

/**
 * Toggle on a selection: if every element has the tag, remove it from all; otherwise add it
 * to the ones missing it (a mixed selection is completed, never stripped).
 */
export function togglePatches(els: Taggable[], tagId: string): TagPatch[] {
  const remove = tagState(els, tagId) === 'all';
  const out: TagPatch[] = [];
  for (const el of els) {
    const cur = el.tags ?? [];
    const has = cur.includes(tagId);
    if (remove && has) out.push(tagsPatch(el.id, cur.filter((t) => t !== tagId)));
    else if (!remove && !has) out.push(tagsPatch(el.id, [...cur, tagId]));
  }
  return out;
}

/** Deleting a tag: strip its id from every element that carries it. */
export function stripPatches(els: readonly BoardElement[], tagId: string): TagPatch[] {
  return els
    .filter(isTaggable)
    .filter((el) => el.tags?.includes(tagId))
    .map((el) => tagsPatch(el.id, el.tags!.filter((t) => t !== tagId)));
}

/** The palette color used least so far, so new tags are told apart at a glance. */
export function nextColor(tags: Tag[]): string {
  const counts = new Map(TAG_COLORS.map((c) => [c, 0]));
  for (const t of tags) if (counts.has(t.color)) counts.set(t.color, counts.get(t.color)! + 1);
  let best = TAG_COLORS[0];
  for (const c of TAG_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}

export const normName = (s: string) => s.trim().replace(/\s+/g, ' ');

export function search(tags: Tag[], query: string): Tag[] {
  const q = normName(query).toLowerCase();
  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  return q ? sorted.filter((t) => t.name.toLowerCase().includes(q)) : sorted;
}
