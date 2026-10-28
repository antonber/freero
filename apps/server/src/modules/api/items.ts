// Items over the API: what a caller may send to create or change one, turned into the same fully
// specified elements the app's tools make (the shared layout kit), placed by the app's rules —
// on free space unless the caller gives a position, in the innermost frame under its center —
// and how an item reads back. Pure over a board view, so `changeBoard` plans with it against the
// live board in one step.
import {
  API_CREATABLE_TYPES,
  API_MAX_ITEMS_PER_CALL,
  connectorDraft,
  findFreeSpot,
  frameDraft,
  measureText,
  plainToRichText,
  richTextToPlain,
  rotatedBounds,
  shapeDraft,
  STICKY_COLORS,
  STICKY_SIZE,
  stickyDraft,
  textDraft,
  unionRects,
  type Anchor,
  type ApiCreatableType,
  type ApiItem,
  type BoardElement,
  type ElementDraft,
  type Rect,
  type ShapeKind,
  type StickyColor,
} from '@freero/shared';
import { badRequest } from '../../platform/http';
import type { BoardChange, BoardView } from '../realtime/index';

const SHAPES = [
  'rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star',
  'cross', 'arrowRight', 'arrowLeft', 'chevron', 'speech', 'cloud', 'cylinder', 'document', 'terminator', 'predefinedProcess',
] as const satisfies readonly ShapeKind[];
const CARD_STATUS = ['todo', 'doing', 'done'] as const;
const CAPS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 10_000;
const GAP = 48;
const DEFAULT_SIZE: Record<ApiCreatableType, { w: number; h: number }> = {
  sticky: { w: STICKY_SIZE, h: STICKY_SIZE },
  shape: { w: 160, h: 100 },
  text: { w: 320, h: 40 },
  card: { w: 300, h: 120 },
  frame: { w: 800, h: 600 },
  connector: { w: 1, h: 1 },
};
const CARD_ACCENT = '#5B3FF0';

type Input = Record<string, unknown>;
const bad = (i: number | null, m: string) => badRequest(i === null ? m : `items[${i}]: ${m}`);

function str(v: unknown, field: string, i: number | null, max = MAX_TEXT): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw bad(i, `${field} must be a string`);
  if (v.length > max) throw bad(i, `${field} is longer than ${max} characters`);
  return v;
}
function num(v: unknown, field: string, i: number | null, min = -1e7, max = 1e7): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw bad(i, `${field} must be a number from ${min} to ${max}`);
  return Math.round(v * 100) / 100;
}
function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], i: number | null): T | undefined {
  if (v === undefined) return undefined;
  if (!allowed.includes(v as T)) throw bad(i, `${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}
function color(v: unknown, field: string, i: number | null): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !HEX.test(v)) throw bad(i, `${field} must be a #RRGGBB color`);
  return v;
}
function link(v: unknown, i: number | null): string | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== 'string' || v.length > 2000 || !/^(https?:|mailto:|tel:|#)/i.test(v)) throw bad(i, 'link must be an http(s), mailto: or tel: URL, or #<itemId>');
  return v;
}

/** The items a create call asks for: `{ items: [...] }` or one item. Refused whole if any is wrong. */
export function readItemInputs(body: unknown): Input[] {
  const b = body as Input | null;
  if (!b || typeof b !== 'object') throw badRequest('Send an item ({ type, … }) or { items: [ … ] }');
  const items = Array.isArray(b.items) ? b.items : [b];
  if (!items.length) throw badRequest('items is empty');
  if (items.length > API_MAX_ITEMS_PER_CALL) throw badRequest(`At most ${API_MAX_ITEMS_PER_CALL} items per call (nothing was created)`);
  return items.map((it, i) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw bad(i, 'must be an object');
    const type = (it as Input).type;
    if (!API_CREATABLE_TYPES.includes(type as ApiCreatableType)) throw bad(i, `type must be one of ${API_CREATABLE_TYPES.join(', ')}`);
    return it as Input;
  });
}

const frames = (els: Iterable<BoardElement>) => [...els].filter((e) => e.type === 'frame');

/** The innermost frame under a point (the app's membership rule), among frames the caller sees. */
function frameAt(cx: number, cy: number, byId: ReadonlyMap<string, BoardElement>, exclude?: string): string | null {
  let best: BoardElement | null = null;
  for (const f of frames(byId.values())) {
    if (f.id === exclude) continue;
    if (cx < f.x || cy < f.y || cx > f.x + f.w || cy > f.y + f.h) continue;
    if (!best || f.w * f.h < best.w * best.h) best = f;
  }
  return best?.id ?? null;
}

/** The anchor side of `r` facing `p`. */
function sideToward(r: Rect, p: { x: number; y: number }): Exclude<Anchor, 'auto'> {
  const dx = p.x - (r.x + r.w / 2);
  const dy = p.y - (r.y + r.h / 2);
  return Math.abs(dx) * r.h > Math.abs(dy) * r.w ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
}

/**
 * Plans the creation of `inputs` on the board as `view` shows it to the actor: one draft per item
 * (fresh ids from `newId`), placed where asked or on free space (never on what is there or was
 * just placed), each in the frame under its center. Connectors attach to items by id — on the
 * board or created earlier in the same call (`from: "$0"` names items[0]).
 */
export function planCreate(inputs: Input[], view: BoardView, newId: () => string): { change: BoardChange; ids: string[] } {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const obstacles: Rect[] = view.elements.map((e) => rotatedBounds(e.el));
  const content = unionRects(obstacles);
  const center = content ? { x: content.x + content.w / 2, y: content.y + content.h / 2 } : { x: 0, y: 0 };
  const created: ElementDraft[] = [];
  const ids: string[] = [];
  const ref = (v: unknown, field: string, i: number): BoardElement => {
    const id = str(v, field, i, 200);
    if (!id) throw bad(i, `${field} is required`);
    const m = /^\$(\d+)$/.exec(id);
    const target = m ? (Number(m[1]) < i ? byId.get(ids[Number(m[1])]) : undefined) : byId.get(id);
    if (!target) throw bad(i, `${field}: no item ${id}${m ? ' earlier in this call' : ' on this board'}`);
    return target;
  };

  inputs.forEach((it, i) => {
    const type = it.type as ApiCreatableType;
    const id = newId();
    const text = str(it.text, 'text', i) ?? '';
    let draft: ElementDraft;
    if (type === 'connector') {
      const a = ref(it.from, 'from', i);
      const b = ref(it.to, 'to', i);
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
      const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      draft = connectorDraft(
        id,
        { id: a.id, anchor: sideToward(a, bc), rect: a },
        { id: b.id, anchor: sideToward(b, ac), rect: b },
        {
          label: str(it.label, 'label', i, 500) ?? (text || undefined),
          routing: oneOf(it.routing, 'routing', ['straight', 'elbow', 'curved'] as const, i),
          stroke: color(it.stroke, 'stroke', i),
          startCap: oneOf(it.startCap, 'startCap', CAPS, i),
          endCap: oneOf(it.endCap, 'endCap', CAPS, i),
        },
      );
    } else {
      const size = { w: num(it.w, 'w', i, 8, 20_000) ?? DEFAULT_SIZE[type].w, h: num(it.h, 'h', i, 8, 20_000) ?? DEFAULT_SIZE[type].h };
      if (type === 'sticky') size.h = size.w;
      if (type === 'text') size.h = measureText(text, { fontSize: num(it.fontSize, 'fontSize', i, 8, 200) ?? 18, maxWidth: size.w, lineHeight: 1.4 }).h + 8;
      if (type === 'card') {
        const t = measureText(str(it.title, 'title', i, 500) ?? text, { fontSize: 16, maxWidth: size.w - 40, bold: true, lineHeight: 1.35 }).h;
        const desc = str(it.description, 'description', i);
        const dh = desc ? Math.min(66, measureText(desc, { fontSize: 14, maxWidth: size.w - 40, lineHeight: 1.4 }).h) + 8 : 0;
        size.h = it.h === undefined ? Math.round(18 + t + dh + 12 + 28 + 14) : size.h;
      }
      const x = num(it.x, 'x', i);
      const y = num(it.y, 'y', i);
      if ((x === undefined) !== (y === undefined)) throw bad(i, 'give both x and y, or neither');
      let at: { x: number; y: number };
      if (x !== undefined && y !== undefined) at = { x, y };
      else {
        const nearId = it.near === undefined ? null : ref(it.near, 'near', i);
        const near = nearId ? { x: nearId.x + nearId.w + GAP + size.w / 2, y: nearId.y + nearId.h / 2 } : center;
        at = findFreeSpot(obstacles, size, near, GAP);
      }
      const r = { x: at.x, y: at.y, w: size.w, h: size.h };
      if (type === 'sticky') {
        const c = oneOf(it.color, 'color', Object.keys(STICKY_COLORS) as StickyColor[], i) ?? 'yellow';
        draft = stickyDraft(id, r.x, r.y, text, c, r.w);
      } else if (type === 'shape') {
        draft = shapeDraft(id, oneOf(it.shape, 'shape', SHAPES, i) ?? 'rect', r, text, {
          fill: color(it.fill, 'fill', i),
          stroke: color(it.stroke, 'stroke', i),
          fontSize: num(it.fontSize, 'fontSize', i, 8, 200),
        });
      } else if (type === 'text') {
        draft = textDraft(id, r.x, r.y, r.w, text, { size: num(it.fontSize, 'fontSize', i, 8, 200), color: color(it.color, 'color', i) });
      } else if (type === 'frame') {
        draft = { ...frameDraft(id, r, str(it.title, 'title', i, 200) ?? text), ...(it.hidden === true ? { hidden: true } : {}) } as ElementDraft;
      } else {
        draft = {
          id,
          type: 'card',
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          rotation: 0,
          title: plainToRichText(str(it.title, 'title', i, 500) ?? text),
          description: plainToRichText(str(it.description, 'description', i) ?? ''),
          color: color(it.color, 'color', i) ?? CARD_ACCENT,
          status: oneOf(it.status, 'status', CARD_STATUS, i) ?? 'todo',
          dueDate: it.dueDate === undefined ? null : (str(it.dueDate, 'dueDate', i, 10) ?? null),
          assigneeId: it.assigneeId === undefined ? null : (str(it.assigneeId, 'assigneeId', i, 64) ?? null),
          tags: [],
        } as ElementDraft;
        if ((draft as { dueDate: string | null }).dueDate && !DATE.test((draft as { dueDate: string }).dueDate)) throw bad(i, 'dueDate must be YYYY-MM-DD');
      }
      const frameId = it.frameId === undefined ? frameAt(r.x + r.w / 2, r.y + r.h / 2, byId) : it.frameId === null ? null : ref(it.frameId, 'frameId', i).id;
      if (frameId && byId.get(frameId)?.type !== 'frame') throw bad(i, 'frameId must name a frame');
      if (type !== 'frame' && frameId) draft = { ...draft, frameId };
      obstacles.push(rotatedBounds(r));
    }
    const l = link(it.link, i);
    if (l !== undefined) draft = { ...draft, link: l } as ElementDraft;
    created.push(draft);
    ids.push(id);
    byId.set(id, { ...draft, z: 0, createdBy: '', createdAt: 0, updatedAt: 0 } as BoardElement);
  });
  return { change: { create: created }, ids };
}

/** Which element field holds an item's main text, and whether it is rich text. */
function textField(el: BoardElement): { key: string; rich: boolean } | null {
  switch (el.type) {
    case 'sticky':
    case 'shape':
    case 'text':
    case 'mindmap':
      return { key: 'text', rich: true };
    case 'card':
      return { key: 'title', rich: true };
    case 'frame':
      return { key: 'title', rich: false };
    case 'connector':
      return { key: 'label', rich: true };
    default:
      return null;
  }
}

/**
 * A field patch from what the caller sends to change `el`: only fields that type has, validated
 * like a create. Position changes re-apply the frame rule unless `frameId` is given.
 */
export function planPatch(el: BoardElement, body: unknown, view: BoardView): Record<string, unknown> {
  const it = body as Input | null;
  if (!it || typeof it !== 'object' || Array.isArray(it)) throw badRequest('Send the fields to change');
  const patch: Record<string, unknown> = {};
  const has = (k: string) => it[k] !== undefined;
  const only = (k: string, types: string[]) => {
    if (has(k) && !types.includes(el.type)) throw badRequest(`A ${el.type} has no ${k}`);
    return has(k);
  };
  if (el.locked && Object.keys(it).some((k) => k !== 'locked')) throw badRequest('This item is locked; unlock it first ({ "locked": false })');
  if (has('text')) {
    const f = textField(el);
    if (!f) throw badRequest(`A ${el.type} has no text`);
    const t = str(it.text, 'text', null) ?? '';
    patch[f.key] = f.rich ? plainToRichText(t) : t;
  }
  if (only('title', ['card', 'frame'])) patch.title = el.type === 'card' ? plainToRichText(str(it.title, 'title', null, 500) ?? '') : (str(it.title, 'title', null, 200) ?? '');
  if (only('description', ['card'])) patch.description = plainToRichText(str(it.description, 'description', null) ?? '');
  if (only('status', ['card'])) patch.status = oneOf(it.status, 'status', CARD_STATUS, null);
  if (only('dueDate', ['card'])) {
    const d = it.dueDate === null ? null : str(it.dueDate, 'dueDate', null, 10);
    if (d && !DATE.test(d)) throw badRequest('dueDate must be YYYY-MM-DD');
    patch.dueDate = d ?? null;
  }
  if (only('assigneeId', ['card'])) patch.assigneeId = it.assigneeId === null ? null : str(it.assigneeId, 'assigneeId', null, 64);
  if (has('color')) {
    if (el.type === 'sticky') patch.color = oneOf(it.color, 'color', Object.keys(STICKY_COLORS) as StickyColor[], null);
    else if (el.type === 'card') patch.color = color(it.color, 'color', null);
    else if (el.type === 'text') patch.textColor = color(it.color, 'color', null);
    else throw badRequest(`A ${el.type} has no color; use fill or stroke`);
  }
  if (only('fill', ['shape', 'frame'])) patch.fill = color(it.fill, 'fill', null);
  if (only('stroke', ['shape', 'connector'])) patch.stroke = color(it.stroke, 'stroke', null);
  if (only('shape', ['shape'])) patch.shape = oneOf(it.shape, 'shape', SHAPES, null);
  if (only('hidden', ['frame'])) {
    if (typeof it.hidden !== 'boolean') throw badRequest('hidden must be true or false');
    patch.hidden = it.hidden;
  }
  if (has('locked')) {
    if (typeof it.locked !== 'boolean') throw badRequest('locked must be true or false');
    patch.locked = it.locked;
  }
  if (has('link')) patch.link = link(it.link, null) ?? null;
  for (const k of ['x', 'y', 'w', 'h', 'rotation'] as const) {
    if (!has(k)) continue;
    if (el.type === 'connector') throw badRequest('A connector follows the items it joins; move those instead');
    patch[k] = k === 'w' || k === 'h' ? num(it[k], k, null, 8, 20_000) : k === 'rotation' ? num(it[k], k, null, -360, 360) : num(it[k], k, null);
  }
  if (el.type === 'sticky' && (has('w') || has('h'))) patch.h = patch.w = patch.w ?? patch.h;
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  if (has('frameId')) {
    const f = it.frameId === null ? null : str(it.frameId, 'frameId', null, 200);
    if (f && (byId.get(f)?.type !== 'frame' || f === el.id)) throw badRequest('frameId must name another frame on this board');
    patch.frameId = f ?? null;
  } else if ((has('x') || has('y') || has('w') || has('h')) && el.type !== 'frame') {
    const next = { ...el, ...patch } as BoardElement;
    patch.frameId = frameAt(next.x + next.w / 2, next.y + next.h / 2, byId, el.id);
  }
  // A frame that moves takes its contents along, as a drag does.
  if (el.type === 'frame' && (has('x') || has('y'))) {
    const dx = (patch.x as number | undefined ?? el.x) - el.x;
    const dy = (patch.y as number | undefined ?? el.y) - el.y;
    if (dx || dy) patch.__moveChildren = { dx, dy };
  }
  if (!Object.keys(patch).length) throw badRequest('Nothing to change');
  return patch;
}

/** The updates a patch makes: the item itself, and — for a moved frame — everything inside it (any depth). */
export function patchUpdates(el: BoardElement, patch: Record<string, unknown>, view: BoardView): NonNullable<BoardChange['update']> {
  const { __moveChildren, ...own } = patch as Record<string, unknown> & { __moveChildren?: { dx: number; dy: number } };
  const out: NonNullable<BoardChange['update']> = [{ id: el.id, patch: own }];
  if (!__moveChildren) return out;
  const inside = new Set([el.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { el: c } of view.elements)
      if (!inside.has(c.id) && ((c.frameId && inside.has(c.frameId)) || (c.attachedTo && inside.has(c.attachedTo)))) {
        inside.add(c.id);
        grew = true;
      }
  }
  inside.delete(el.id);
  for (const { el: c } of view.elements) {
    if (!inside.has(c.id) || c.locked) continue;
    const p: Record<string, unknown> = { x: c.x + __moveChildren.dx, y: c.y + __moveChildren.dy };
    if (c.type === 'connector') {
      const conn = c as BoardElement & { start: { x: number; y: number }; end: { x: number; y: number }; waypoints?: Array<{ x: number; y: number }> };
      p.start = { ...conn.start, x: conn.start.x + __moveChildren.dx, y: conn.start.y + __moveChildren.dy };
      p.end = { ...conn.end, x: conn.end.x + __moveChildren.dx, y: conn.end.y + __moveChildren.dy };
      if (conn.waypoints) p.waypoints = conn.waypoints.map((w) => ({ x: w.x + __moveChildren.dx, y: w.y + __moveChildren.dy }));
    }
    out.push({ id: c.id, patch: p });
  }
  return out;
}

const BASE_KEYS = new Set(['id', 'type', 'x', 'y', 'w', 'h', 'rotation', 'z', 'frameId', 'locked', 'createdBy', 'createdAt', 'updatedAt']);

/** An element as the API returns it: the common fields, its text as plain text, the rest under `data`. */
export function toApiItem(el: BoardElement, layer: 'shared' | 'editors' | 'private'): ApiItem {
  const f = textField(el);
  const raw = f ? (el as unknown as Record<string, unknown>)[f.key] : undefined;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el)) if (!BASE_KEYS.has(k)) data[k] = v;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    id: el.id,
    type: el.type,
    text: typeof raw === 'string' ? (f!.rich ? richTextToPlain(raw) : raw) : null,
    x: n(el.x) ?? 0,
    y: n(el.y) ?? 0,
    w: n(el.w) ?? 0,
    h: n(el.h) ?? 0,
    rotation: n(el.rotation) ?? 0,
    frameId: typeof el.frameId === 'string' ? el.frameId : null,
    locked: el.locked === true,
    ...(layer === 'private' ? { private: true as const } : {}),
    createdBy: typeof el.createdBy === 'string' ? el.createdBy : null,
    createdAt: n(el.createdAt),
    updatedAt: n(el.updatedAt),
    data,
  };
}

/** Where a board-level comment pin goes: just right of the content (or the origin). */
export function commentSpot(view: BoardView): { x: number; y: number } {
  const content = unionRects(view.elements.map((e) => rotatedBounds(e.el)));
  return content ? { x: Math.round(content.x + content.w + 40), y: Math.round(content.y) } : { x: 0, y: 0 };
}

