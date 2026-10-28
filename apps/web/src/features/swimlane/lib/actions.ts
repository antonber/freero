// Swimlane edits. Each is one Editor.transact (one undo step) that writes the pool and moves its
// items with their bands through `moveBy` (so attached lines follow and riders come along); the
// arrange pass then grows any band that no longer fits.
import { nanoid } from 'nanoid';
import type { SwimlaneBand, SwimlaneElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { DEFAULT_COLUMN_LANE, DEFAULT_LANE, DEFAULT_PHASE, DEFAULT_ROW_PHASE, reflow, sizeOf } from './layout';

/** Header tints, in the order new lanes take them. */
export const LANE_COLORS = ['#E9E4FF', '#DDF0FF', '#DDF6EA', '#FFF1D6', '#FFE3E0', '#F1F0F5'];

export type BandKind = 'lanes' | 'phases';

const band = (title: string, size: number, color: string): SwimlaneBand => ({ id: nanoid(8), title, size, color });

export function newSwimlane(at: Point): NewElement<'swimlane'> {
  const lanes = ['Customer', 'Team', 'System'].map((t, i) => band(t, DEFAULT_LANE, LANE_COLORS[i]));
  const phases = [band('Phase', DEFAULT_PHASE, LANE_COLORS[5])];
  const { w, h } = sizeOf({ lanes, phases });
  return { type: 'swimlane', x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, title: 'Swimlanes', lanes, phases };
}

function fresh(editor: Editor, id: string): SwimlaneElement | null {
  const el = editor.getElement<SwimlaneElement>(id);
  return el && el.type === 'swimlane' && !el.locked ? el : null;
}

/** Writes new bands (and orientation), carrying every item along with its lane and phase. */
function setBands(
  editor: Editor,
  id: string,
  next: Pick<SwimlaneElement, 'lanes' | 'phases'> & { vertical?: boolean },
  fallback: { lane?: string | null; phase?: string | null } = {},
) {
  const p = fresh(editor, id);
  if (!p || !next.lanes.length || !next.phases.length) return;
  const after = { vertical: next.vertical ?? p.vertical, lanes: next.lanes, phases: next.phases };
  const moves = reflow(p, after, editor.getElements(), fallback);
  editor.transact(() => {
    editor.update<SwimlaneElement>(id, { ...after, ...sizeOf(after) });
    if (moves.length) editor.moveBy(moves);
  });
}

const kindSize = (p: SwimlaneElement, kind: BandKind) =>
  kind === 'lanes' ? (p.vertical ? DEFAULT_COLUMN_LANE : DEFAULT_LANE) : p.vertical ? DEFAULT_ROW_PHASE : DEFAULT_PHASE / 3;

/** Inserts a band at `index` (0 = first). Returns its id. */
export function addBand(editor: Editor, id: string, kind: BandKind, index?: number): string | null {
  const p = fresh(editor, id);
  if (!p) return null;
  const list = p[kind];
  const at = Math.max(0, Math.min(list.length, index ?? list.length));
  // The first added phase splits the pool into two phases (the existing one becomes "Phase 1").
  const color = kind === 'lanes' ? LANE_COLORS[list.length % (LANE_COLORS.length - 1)] : LANE_COLORS[5];
  const title = kind === 'lanes' ? 'New lane' : `Phase ${list.length + 1}`;
  const b = band(title, kindSize(p, kind), color);
  setBands(editor, id, { lanes: p.lanes, phases: p.phases, [kind]: [...list.slice(0, at), b, ...list.slice(at)] });
  return b.id;
}

/** Swaps a band with its neighbour; their items swap places with them. */
export function moveBand(editor: Editor, id: string, kind: BandKind, bandId: string, dir: -1 | 1) {
  const p = fresh(editor, id);
  if (!p) return;
  const list = [...p[kind]];
  const i = list.findIndex((b) => b.id === bandId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  setBands(editor, id, { lanes: p.lanes, phases: p.phases, [kind]: list });
}

/** Removes a band; its items move into the neighbouring one. The last band can't go. */
export function removeBand(editor: Editor, id: string, kind: BandKind, bandId: string) {
  const p = fresh(editor, id);
  if (!p || p[kind].length < 2) return;
  const i = p[kind].findIndex((b) => b.id === bandId);
  if (i < 0) return;
  const neighbour = p[kind][i > 0 ? i - 1 : 1].id;
  setBands(
    editor,
    id,
    { lanes: p.lanes, phases: p.phases, [kind]: p[kind].filter((b) => b.id !== bandId) },
    kind === 'lanes' ? { lane: neighbour } : { phase: neighbour },
  );
}

export function patchBand(editor: Editor, id: string, kind: BandKind, bandId: string, patch: Partial<Omit<SwimlaneBand, 'id'>>) {
  const p = fresh(editor, id);
  if (!p) return;
  editor.update<SwimlaneElement>(id, { [kind]: p[kind].map((b) => (b.id === bandId ? { ...b, ...patch } : b)) });
}

/** Lanes as rows ⇄ as columns; every item keeps its place inside its lane and phase. */
export function setVertical(editor: Editor, id: string, vertical: boolean) {
  const p = fresh(editor, id);
  if (!p || !!p.vertical === vertical) return;
  // Bands keep their sizes along their own direction, except the defaults that suit each layout.
  setBands(editor, id, { vertical, lanes: p.lanes, phases: p.phases });
}

/**
 * Live band resize (a header edge dragged): band `i` takes `size`; the items of the bands after
 * it move by the change. Call inside a gesture: the drag is one undo step.
 */
export function resizeBand(editor: Editor, id: string, kind: BandKind, bandId: string, size: number) {
  const p = fresh(editor, id);
  if (!p) return;
  const list = p[kind].map((b) => (b.id === bandId ? { ...b, size: Math.round(size) } : b));
  setBands(editor, id, { lanes: p.lanes, phases: p.phases, [kind]: list });
}

export const bandPart = (kind: BandKind, bandId: string) => `${kind === 'lanes' ? 'lane' : 'phase'}:${bandId}`;

export function parseBandPart(part: string | null): { kind: BandKind; id: string } | null {
  const m = part?.match(/^(lane|phase):(.+)$/);
  return m ? { kind: m[1] === 'lane' ? 'lanes' : 'phases', id: m[2] } : null;
}

export function renameBand(editor: Editor, id: string, kind: BandKind, bandId: string) {
  editor.select([id]);
  editor.startEditing(id, { part: bandPart(kind, bandId), selectAll: true });
}
