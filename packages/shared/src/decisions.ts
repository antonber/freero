// Decision snapshots (KAI-161): "freeze this for the decision". A board, or one frame of it, kept
// under a name exactly as it was, read-only, with its own address (`freero://decision/<id>`, web
// `/decision/<id>`) that tracker issues, docs and other boards can cite. Built on version history:
// the content is a board snapshot of kind 'decision' (never pruned, listed in the board's history),
// and nothing ever writes it again — editing the board afterwards never changes what a decision
// shows.
//
// Who sees one: whoever may open its board now (the registry's one check). A decision holds only
// the SHARED board — never hidden frames' contents or anyone's private drafts — as it was when
// someone with edit access chose to publish it.
//
// GET    /api/boards/:id/decisions        -> { decisions: Decision[] }   (newest first; viewers and up)
// POST   /api/boards/:id/decisions        body CreateDecisionRequest -> { decision }   (editors and owners)
// GET    /api/decisions/:id               -> DecisionResponse
// GET    /api/decisions/:id/state         -> application/octet-stream: the frozen Yjs state (a frame
//                                            decision holds only that frame's items)
// GET    /api/decisions/:id/changes       -> DecisionChanges  ("what changed since this decision")
// DELETE /api/decisions/:id               -> 204 (editors and owners; the version stays in history)
import type { BoardOutline, OutlineItem } from './outline/types';

export const MAX_DECISION_TITLE = 120;
export const MAX_DECISION_NOTE = 2000;

export interface Decision {
  id: string;
  boardId: string;
  title: string;
  note: string;
  /** A frame decision: only this frame (and what is inside it) was frozen. */
  frameId: string | null;
  /** The frame's title when it was frozen. */
  frameTitle: string | null;
  createdAt: number;
  createdBy: { id: string; name: string } | null;
  /** The board version it is (version history). */
  versionId: number;
}

export interface CreateDecisionRequest {
  title: string;
  note?: string;
  frameId?: string;
}

export interface DecisionResponse {
  decision: Decision;
  board: { id: string; title: string };
  /** The reader may edit the live board (delete the decision). */
  canManage: boolean;
}

/** One item in a "what changed" summary, as the outline reads it. */
export interface DecisionChangeItem {
  id: string;
  /** Element type ('sticky', 'card', …). */
  kind: string;
  /** Its text now (or, for a removed item, then). */
  text: string;
  /** For a changed item: its text at the decision. */
  before?: string;
  /** The frame it is in (title), if any. */
  frame?: string;
}

/**
 * What differs between the decision and the board now, read through the board outline (KAI-166)
 * of both: items added, removed, or with different text / frame. Only what every reader of the
 * board sees is compared (hidden frames and private drafts are in neither). A frame decision
 * compares just that frame. Each list is capped at MAX_DECISION_CHANGES (counts are exact).
 */
export interface DecisionChanges {
  since: number;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  added: DecisionChangeItem[];
  removed: DecisionChangeItem[];
  changed: DecisionChangeItem[];
  /** The frame of a frame decision is gone from the board. */
  frameGone: boolean;
}

export const MAX_DECISION_CHANGES = 50;

// ---- "what changed", from the outlines of both (pure: the server computes it) ----

interface Flat {
  kind: string;
  /** What the item says (title, text, table rows, fields, tags, link), as one comparable string. */
  sig: string;
  /** Short text to show. */
  text: string;
  frame: string | undefined;
}

/** 'cluster:…', 'group:…', '<kanban>:<column>': made-up outline nodes, not items. */
const SYNTHETIC = /:/;

function readable(item: OutlineItem): string {
  const parts = [item.title, item.text, ...(item.rows ?? []).map((r) => r.join(' | '))].filter((p): p is string => !!p && !!p.trim());
  const t = parts.join(' — ').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
}

function flatten(outline: BoardOutline): Map<string, Flat> {
  const out = new Map<string, Flat>();
  const walk = (items: OutlineItem[], frame: string | undefined) => {
    for (const it of items) {
      if (!SYNTHETIC.test(it.id)) {
        const fields = it.fields ? Object.entries(it.fields).sort(([a], [b]) => a.localeCompare(b)) : [];
        const sig = JSON.stringify([it.title ?? '', it.text ?? '', it.rows ?? [], fields, [...(it.tags ?? [])].sort(), it.link ?? '']);
        out.set(it.id, { kind: it.kind, sig, text: readable(it), frame });
      }
      if (it.children) walk(it.children, it.kind === 'frame' ? it.title || 'Untitled frame' : frame);
    }
  };
  walk(outline.items, undefined);
  for (const e of outline.edges) out.set(e.id, { kind: 'connector', sig: JSON.stringify([e.from, e.to, e.label ?? '', e.arrow ?? '']), text: e.label ?? '', frame: undefined });
  return out;
}

/**
 * What differs between the board at the decision (`before`) and now (`after`): items only in one
 * of them, and items whose content or frame changed. Moving an item around within its frame is
 * not a change of substance; its text, table rows, fields, tags, link and frame are.
 */
export function diffOutlines(before: BoardOutline, after: BoardOutline, since: number, max = MAX_DECISION_CHANGES): DecisionChanges {
  const a = flatten(before);
  const b = flatten(after);
  const item = (id: string, f: Flat): DecisionChangeItem => ({ id, kind: f.kind, text: f.text, ...(f.frame ? { frame: f.frame } : {}) });
  const added: DecisionChangeItem[] = [];
  const removed: DecisionChangeItem[] = [];
  const changed: DecisionChangeItem[] = [];
  let unchanged = 0;
  for (const [id, now] of b) {
    const then = a.get(id);
    if (!then) added.push(item(id, now));
    else if (then.sig !== now.sig || then.frame !== now.frame) changed.push({ ...item(id, now), before: then.text });
    else unchanged++;
  }
  for (const [id, then] of a) if (!b.has(id)) removed.push(item(id, then));
  return {
    since,
    counts: { added: added.length, removed: removed.length, changed: changed.length, unchanged },
    added: added.slice(0, max),
    removed: removed.slice(0, max),
    changed: changed.slice(0, max),
    frameGone: false,
  };
}
