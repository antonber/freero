// Suggestions over the API (KAI-169): what a caller may propose — new items, field changes and
// deletions, in the same shapes as the items endpoints — planned with the SAME planners as a
// direct write (items.ts), so accepting a suggestion later does exactly what writing it now
// would have done; and how pending suggestions read back, grouped as they were proposed.
import {
  API_MAX_ITEMS_PER_CALL,
  MAX_SUGGESTION_DESCRIPTION,
  suggestedElement,
  type ApiSuggestion,
  type ApiSuggestionGroup,
} from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import { reviewSuggestions, type BoardChange, type BoardView } from '../realtime/index';
import { newElementId } from '../structure/index';
import { patchUpdates, planCreate, planPatch, readItemInputs, toApiItem } from './items';

type Input = Record<string, unknown>;

export interface Proposal {
  description: string;
  create: Input[];
  update: Array<{ id: string; fields: Input }>;
  remove: string[];
}

/** `{ description?, create?: [items], update?: [{ id, …fields }], delete?: [ids] }`, refused whole if any part is wrong. */
export function readProposal(body: unknown): Proposal {
  const b = body as Input | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('Send { description, create: [ … ], update: [ … ], delete: [ … ] }');
  const description = b.description === undefined ? '' : b.description;
  if (typeof description !== 'string' || description.length > MAX_SUGGESTION_DESCRIPTION)
    throw badRequest(`description must be text of at most ${MAX_SUGGESTION_DESCRIPTION} characters`);
  const list = (k: string) => {
    const v = b[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw badRequest(`${k} must be a list`);
    return v as unknown[];
  };
  const create = list('create');
  const update = list('update').map((u, i) => {
    if (!u || typeof u !== 'object' || Array.isArray(u)) throw badRequest(`update[${i}] must be an object`);
    const { id, ...fields } = u as Input;
    if (typeof id !== 'string' || !id || id.length > 200) throw badRequest(`update[${i}].id must be an item id`);
    return { id, fields };
  });
  const remove = list('delete').map((id, i) => {
    if (typeof id !== 'string' || !id || id.length > 200) throw badRequest(`delete[${i}] must be an item id`);
    return id;
  });
  const total = create.length + update.length + remove.length;
  if (!total) throw badRequest('Nothing to suggest: send create, update or delete');
  if (total > API_MAX_ITEMS_PER_CALL) throw badRequest(`At most ${API_MAX_ITEMS_PER_CALL} changes per suggestion (nothing was proposed)`);
  return { description: description.trim(), create: create.length ? readItemInputs({ items: create }) : [], update, remove: [...new Set(remove)] };
}

/** The proposal as a board change against the live board, exactly as the items endpoints would make it. */
export function planProposal(p: Proposal, view: BoardView): BoardChange {
  const created = p.create.length ? planCreate(p.create, view, newElementId).change.create ?? [] : [];
  const update: NonNullable<BoardChange['update']> = [];
  for (const u of p.update) {
    const hit = view.elements.find((e) => e.el.id === u.id);
    if (!hit) throw notFound(`No item ${u.id} on this board`);
    if (hit.layer === 'private') throw badRequest(`Item ${u.id} is a private draft only you see: change it directly`);
    update.push(...patchUpdates(hit.el, planPatch(hit.el, u.fields, view), view));
  }
  for (const id of p.remove) {
    const hit = view.elements.find((e) => e.el.id === id);
    if (!hit) throw notFound(`No item ${id} on this board`);
    if (hit.layer === 'private') throw badRequest(`Item ${id} is a private draft only you see: delete it directly`);
    if (hit.el.locked) throw badRequest(`Item ${id} is locked`);
  }
  return { create: created, update, remove: p.remove };
}

/** Pending suggestions as the API returns them, grouped as proposed, oldest group first. */
export function suggestionGroups(view: BoardView): ApiSuggestionGroup[] {
  const where = new Map(view.elements.map((e) => [e.el.id, e]));
  const get = (id: string) => where.get(id)?.el;
  const groups = new Map<string, ApiSuggestionGroup>();
  for (const { record: r, state } of reviewSuggestions(view.suggestions, view)) {
    let g = groups.get(r.groupId);
    if (!g) {
      const { kind, name, userId, userName } = r.author;
      g = { id: r.groupId, author: { kind, name, userId, userName }, description: r.description, createdAt: r.createdAt, suggestions: [] };
      groups.set(r.groupId, g);
    }
    const el = suggestedElement(r, get);
    const itemId = r.op === 'create' ? r.element!.id : r.targetId!;
    const s: ApiSuggestion = {
      id: r.id,
      groupId: r.groupId,
      op: r.op,
      itemId,
      item: el ? toApiItem(el, where.get(itemId)?.layer === 'editors' ? 'editors' : 'shared') : null,
      ...(r.op === 'update' ? { patch: r.patch } : {}),
      state,
    };
    g.suggestions.push(s);
  }
  return [...groups.values()];
}
