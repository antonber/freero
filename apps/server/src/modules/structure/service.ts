// Inserting structure into a board (KAI-167): validate the request, check the caller may edit,
// run it through the chosen sink. Agents and AI never pick coordinates: placement is the layout's.
import { randomBytes } from 'node:crypto';
import { LayoutError, type InsertStructureRequest, type InsertStructureResponse } from '@freero/shared';
import { badRequest } from '../../platform/http';
import { requireBoardAccess } from '../boards/index';
import { BoardChangeError } from '../realtime/index';
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
  if (b.target !== undefined && !(b.target in SINKS)) throw badRequest(`target must be ${Object.keys(SINKS).join(' or ')}`);
  return { structure: b.structure, near: b.near, at: b.at, target: b.target };
}

export async function insertStructure(boardId: string, userId: string, body: unknown): Promise<InsertStructureResponse> {
  const req = parseRequest(body);
  const { role } = await requireBoardAccess(boardId, userId, 'editor');
  const target = req.target ?? 'board';
  let result;
  try {
    result = await SINKS[target].apply(boardId, { userId, role }, req, newElementId);
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
  };
  if (target === 'preview') {
    const now = Date.now();
    out.snapshot = { elements: placed.elements.map((d) => asElement(d, userId, now)), content: placed.content };
    out.moves = placed.moves;
  }
  return out;
}
