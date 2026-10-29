// Inserting structure into a board (KAI-167): validate the request, check the caller may edit,
// run it through the chosen sink. Agents and AI never pick coordinates: placement is the layout's.
import { randomBytes } from 'node:crypto';
import {
  LayoutError,
  MAX_SUGGESTION_DESCRIPTION,
  type InsertStructureRequest,
  type InsertStructureResponse,
  type StructurePlacement,
  type SuggestionAuthor,
} from '@freero/shared';
import { badRequest } from '../../platform/http';
import { requireBoardAccess } from '../boards/index';
import { BoardChangeError, type BoardActor } from '../realtime/index';
import { asElement } from './plan';
import { SINKS } from './sinks';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

/** A fresh element id (21 url-safe characters, like the web's nanoid). */
export function newElementId(): string {
  const bytes = randomBytes(21);
  let id = '';
  for (const b of bytes) id += ALPHABET[b & 63];
  return id;
}

function parseRequest(body: unknown): InsertStructureRequest {
  const b = body as Partial<InsertStructureRequest> | null;
  if (!b || typeof b !== 'object' || !b.structure || typeof b.structure !== 'object') throw badRequest('Send { structure: { kind, … } }');
  if (b.near !== undefined && (typeof b.near !== 'string' || !b.near || b.near.length > 200)) throw badRequest('near must be an element id');
  if (b.at !== undefined && (typeof b.at !== 'object' || !b.at || !Number.isFinite(b.at.x) || !Number.isFinite(b.at.y)))
    throw badRequest('at must be { x, y }');
  if (b.target !== undefined && !Object.hasOwn(SINKS, b.target)) throw badRequest(`target must be ${Object.keys(SINKS).join(', ')}`);
  if (b.description !== undefined && (typeof b.description !== 'string' || b.description.length > MAX_SUGGESTION_DESCRIPTION))
    throw badRequest(`description must be text of at most ${MAX_SUGGESTION_DESCRIPTION} characters`);
  return { structure: b.structure, near: b.near, at: b.at, target: b.target, description: b.description, ...(b.placement !== undefined ? { placement: readPlacement(b.placement) } : {}) };
}

/** `placement` as sent: one of into (with column) / newFrame / newKanban, each a short text. */
export function readPlacement(v: unknown): StructurePlacement {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('placement must be { into, column? } or { newFrame } or { newKanban }');
  const out: StructurePlacement = {};
  for (const k of ['into', 'column', 'newFrame', 'newKanban'] as const) {
    const x = (v as Record<string, unknown>)[k];
    if (x === undefined || x === null) continue;
    if (typeof x !== 'string' || !x.trim() || x.length > 200) throw badRequest(`placement.${k} must be a short text`);
    out[k] = x.trim();
  }
  return out;
}

/**
 * Lays `body` out and sends it to its sink. `by`: the person (their id), or — for the public API
 * and MCP — the person and the app acting for them (attributed to both, KAI-168). With target
 * 'suggestions' that is who the proposal is from ("Claude for Maria"), unless `opts.author` says
 * otherwise (in-app AI: "AI for Maria").
 */
export async function insertStructure(
  boardId: string,
  by: string | Omit<BoardActor, 'role'>,
  body: unknown,
  opts: { author?: SuggestionAuthor } = {},
): Promise<InsertStructureResponse> {
  const req = parseRequest(body);
  const actor = typeof by === 'string' ? { userId: by } : by;
  const userId = actor.userId;
  const { role } = await requireBoardAccess(boardId, userId, 'editor');
  const target = req.target ?? 'board';
  let result;
  try {
    result = await SINKS[target].apply(boardId, { ...actor, role }, req, newElementId, { description: req.description ?? '', author: opts.author });
  } catch (e) {
    // Bad input or a board that changed shape under the plan: nothing was written.
    if (e instanceof LayoutError || e instanceof BoardChangeError) throw badRequest(e.message);
    throw e;
  }
  const { placed } = result;
  const out: InsertStructureResponse = {
    target,
    created: placed.elements.map((e) => e.id),
    moved: placed.moves.map((m) => m.id),
    bounds: placed.bounds,
    ...(placed.parts ? { parts: placed.parts } : {}),
    ...(placed.containerId ? { containerId: placed.containerId } : {}),
    ...(result.groupId ? { groupId: result.groupId } : {}),
  };
  if (target === 'preview') {
    const now = Date.now();
    out.snapshot = { elements: placed.elements.map((d) => asElement(d, userId, now)), content: placed.content };
    out.moves = placed.moves;
  }
  return out;
}
