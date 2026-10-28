// Cluster: sort the selected stickies into labelled groups by colour or by tag. Pure planning plus
// the editor glue that applies it as ONE undo step (moves + the label text boxes).
import { STICKY_COLORS, type StickyColor, type StickyElement, type Tag } from '@freero/shared';
import { plainToRichText, type Editor, type NewElement, type Rect } from '@engine';

export type ClusterBy = 'color' | 'tag';

export interface ClusterItem {
  id: string;
  box: Rect;
  color: StickyColor;
  tags: string[];
}

export interface ClusterPlan {
  moves: Array<{ id: string; dx: number; dy: number }>;
  labels: Array<{ text: string; x: number; y: number; w: number }>;
}

/** Room above each cluster for its label. */
export const LABEL_H = 48;
const COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];
const NO_TAG = '\u0000none';

const colorName = (c: StickyColor) => c[0].toUpperCase() + c.slice(1);

/**
 * Groups → keys in display order: colours in palette order; tags by name, "No tag" last. A sticky
 * with several tags joins the cluster of its first one that still exists.
 */
function groupsOf(items: ClusterItem[], by: ClusterBy, tags: Map<string, Tag>): Array<{ label: string; items: ClusterItem[] }> {
  const map = new Map<string, ClusterItem[]>();
  for (const it of items) {
    const key = by === 'color' ? it.color : (it.tags.find((t) => tags.has(t)) ?? NO_TAG);
    map.set(key, [...(map.get(key) ?? []), it]);
  }
  const keys = [...map.keys()];
  if (by === 'color') keys.sort((a, b) => COLOR_ORDER.indexOf(a as StickyColor) - COLOR_ORDER.indexOf(b as StickyColor));
  else keys.sort((a, b) => (a === NO_TAG ? 1 : b === NO_TAG ? -1 : tags.get(a)!.name.localeCompare(tags.get(b)!.name)));
  return keys.map((k) => ({
    label: by === 'color' ? colorName(k as StickyColor) : k === NO_TAG ? 'No tag' : tags.get(k)!.name,
    items: map.get(k)!,
  }));
}

/**
 * Clusters side by side from the selection's top-left, each a square-ish grid in the stickies'
 * reading order with its label above it. Cells are as big as the cluster's biggest sticky.
 */
export function planClusters(items: ClusterItem[], by: ClusterBy, tags: Map<string, Tag>): ClusterPlan {
  if (!items.length) return { moves: [], labels: [] };
  const x0 = Math.min(...items.map((i) => i.box.x));
  const y0 = Math.min(...items.map((i) => i.box.y));
  const gap = 16;
  const clusterGap = 96;
  const moves: ClusterPlan['moves'] = [];
  const labels: ClusterPlan['labels'] = [];
  let x = x0;
  for (const g of groupsOf(items, by, tags)) {
    const ordered = [...g.items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const cols = Math.ceil(Math.sqrt(ordered.length));
    const cw = Math.max(...ordered.map((i) => i.box.w));
    const ch = Math.max(...ordered.map((i) => i.box.h));
    ordered.forEach((it, i) => {
      const tx = x + (i % cols) * (cw + gap);
      const ty = y0 + LABEL_H + Math.floor(i / cols) * (ch + gap);
      if (Math.abs(tx - it.box.x) > 1e-6 || Math.abs(ty - it.box.y) > 1e-6) moves.push({ id: it.id, dx: tx - it.box.x, dy: ty - it.box.y });
    });
    const w = cols * cw + (cols - 1) * gap;
    labels.push({ text: `${g.label} · ${g.items.length}`, x, y: y0, w });
    x += w + clusterGap;
  }
  return { moves, labels };
}

// ---------------------------------------------------------------- editor glue
export function selectedStickies(editor: Editor): StickyElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is StickyElement => el?.type === 'sticky' && !el.locked);
}

/** Moves the stickies into clusters and adds a label above each: one undo step. */
export function clusterSelection(editor: Editor, by: ClusterBy) {
  const stickies = selectedStickies(editor);
  if (stickies.length < 2) return;
  const tags = new Map(editor.collection<Tag>('tags').entries());
  const items = stickies.map((s) => ({ id: s.id, box: editor.getBounds([s.id]) ?? { x: s.x, y: s.y, w: s.w, h: s.h }, color: s.color, tags: s.tags ?? [] }));
  const plan = planClusters(items, by, tags);
  editor.beginGesture();
  try {
    if (plan.moves.length) editor.moveBy(plan.moves);
    const labelIds = editor.createMany(
      plan.labels.map((l) => ({ type: 'text', x: l.x, y: l.y + 4, w: l.w, h: 32, text: plainToRichText(l.text), fontSize: 20, autoWidth: true }) as unknown as NewElement),
    );
    editor.select([...stickies.map((s) => s.id), ...labelIds]);
  } finally {
    editor.endGesture();
  }
}
