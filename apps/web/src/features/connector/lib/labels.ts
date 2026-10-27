// Connector labels: the main `label` (at `labelT`, default the middle) plus any number of extra
// `labels`, each at its own fraction t (0..1 by length) along the route. Pure, unit-tested.
//
// Editing: the main label is the element's textField (Enter / double-click on it). Every other
// label is an engine text PART (ElementDefinition.textPartAt), named so the label can be drawn
// even before it exists or after it was emptied:
//   main@<t>        the main label while it is still empty, placed where the user double-clicked
//   l:<id>@<t>      an extra label (new: not in `labels` yet)
import { nanoid } from 'nanoid';
import type { ConnectorElement, ConnectorLabel } from '@freero/shared';
import { richTextToPlain, type ElementPatch, type Point, type Rect } from '@engine';
import { labelBox, pointAlong, tAlong } from './geometry';

export const DEFAULT_LABEL_T = 0.5;
/** Labels never sit right on an end (caps, attached shapes). */
const clampT = (t: number) => Math.round(Math.min(0.97, Math.max(0.03, t)) * 1000) / 1000;

export type LabelPart = { kind: 'main'; t: number } | { kind: 'extra'; id: string; t: number };

export function parsePart(part: string | null | undefined): LabelPart | null {
  if (!part) return null;
  const m = /^(main|l:([\w-]+))@([\d.]+)$/.exec(part);
  if (!m) return null;
  const t = clampT(Number(m[3]));
  return m[1] === 'main' ? { kind: 'main', t } : { kind: 'extra', id: m[2], t };
}

export const extraPart = (l: Pick<ConnectorLabel, 'id' | 't'>) => `l:${l.id}@${l.t}`;

type Labelled = Pick<ConnectorElement, 'label' | 'labelT' | 'labels'>;

export const hasMainLabel = (c: Labelled) => !!richTextToPlain(c.label ?? '').trim();

/** Every label with text: where it is along the route (t) and its plain text. */
export function labelSpots(c: Labelled): Array<{ id: string | null; t: number; plain: string }> {
  const out: Array<{ id: string | null; t: number; plain: string }> = [];
  if (hasMainLabel(c)) out.push({ id: null, t: c.labelT ?? DEFAULT_LABEL_T, plain: richTextToPlain(c.label) });
  for (const l of c.labels ?? []) {
    const plain = richTextToPlain(l.text);
    if (plain.trim()) out.push({ id: l.id, t: l.t, plain });
  }
  return out;
}

/** Rough boxes (world) of every label on `poly`, for hit tests and bounds. */
export function labelBoxes(c: Labelled, poly: Point[]): Array<{ id: string | null; t: number; box: Rect }> {
  const out: Array<{ id: string | null; t: number; box: Rect }> = [];
  for (const s of labelSpots(c)) {
    const box = labelBox(s.plain, pointAlong(poly, s.t).p);
    if (box) out.push({ id: s.id, t: s.t, box });
  }
  return out;
}

const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * Which text part a double-click at `p` (world) edits: an extra label under it; null for the main
 * label (the engine edits the textField); else a NEW label where the line was clicked — the main
 * one while it is still empty, an extra one otherwise.
 */
export function partAt(c: Labelled, poly: Point[], p: Point, newId: () => string = nanoid): string | null {
  for (const l of labelBoxes(c, poly)) if (inside(p, l.box)) return l.id === null ? null : extraPart({ id: l.id, t: l.t });
  const t = clampT(tAlong(poly, p));
  return hasMainLabel(c) ? extraPart({ id: newId(), t }) : `main@${t}`;
}

/** The patch that writes `html` into the label `part` names (an emptied extra label goes away). */
export function writeLabel(c: Labelled, part: LabelPart, html: string): ElementPatch<ConnectorElement> {
  const empty = !richTextToPlain(html).trim();
  if (part.kind === 'main') return { label: empty ? '' : html, labelT: part.t };
  const rest = (c.labels ?? []).filter((l) => l.id !== part.id);
  if (empty) return { labels: rest };
  const cur = (c.labels ?? []).find((l) => l.id === part.id);
  return { labels: [...rest, { id: part.id, t: cur?.t ?? part.t, text: html }] };
}

/** The patch that moves label `id` (null = the main label) to `t` along the route. */
export function moveLabel(c: Labelled, id: string | null, t: number): ElementPatch<ConnectorElement> {
  const next = clampT(t);
  if (id === null) return { labelT: next };
  return { labels: (c.labels ?? []).map((l) => (l.id === id ? { ...l, t: next } : l)) };
}
