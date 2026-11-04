// Miro's REST API v2 (developers.miro.com), the few documented read calls "Import from Miro" makes:
// the board, its items and connectors (cursor-paged, 50 a page), its tags, and an image item's
// download link. Reached only at the configured `apiUrl` (api.miro.com; a stand-in in tests) with
// the PERSON'S OWN token, which is never sent anywhere else — not to the host Miro's download link
// points at — and never written into an error, a log line or the answer.
// Everything Miro answers is untrusted: type-checked field by field into @freero/shared MiroItem /
// MiroConnector / MiroTag, strings capped. HTML stays HTML here; the browser reads it as plain text.
import type { MiroConnector, MiroItem, MiroTag } from '@freero/shared';
import { MIRO_MAX_ITEMS } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';

const TIMEOUT_MS = 20_000;
const PAGE = 50;
/** Caps on what one import reads, whatever Miro says. */
const MAX_TEXT = 10_000;
const MAX_TITLE = 500;
const MAX_TAGS = 200;

/** Miro said no (or didn't answer). `status` is Miro's (0: unreachable). Its message never holds the token. */
export class MiroApiError extends Error {
  constructor(public status: number) {
    super(`Miro answered ${status}`);
  }
}

export function apiUrl(): string {
  const miro = getConfig().miroImport;
  if (!miro) throw new HttpError(404, 'This server doesn’t offer import from Miro', 'miro_import_off');
  return miro.apiUrl;
}

/** Is `url` at the configured API's own origin (the only place the token may go)? */
export function atApiOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(apiUrl()).origin;
  } catch {
    return false;
  }
}

/** GET a path or full URL at the API origin with the person's token. */
export async function miroGet(pathOrUrl: string, token: string, deadline: number): Promise<{ body: unknown; type: string; bytes: Buffer }> {
  const url = pathOrUrl.startsWith('/') ? `${apiUrl()}${pathOrUrl}` : pathOrUrl;
  if (!atApiOrigin(url)) throw new MiroApiError(0);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      // A redirect would carry the token to wherever it points: never followed.
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_MS, deadline - Date.now()))),
    });
  } catch {
    throw new MiroApiError(0);
  }
  const bytes = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!res.ok) throw new MiroApiError(res.status);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  let body: unknown = null;
  if (type === 'application/json' || type.endsWith('+json')) {
    try {
      body = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new MiroApiError(502);
    }
  }
  return { body, type, bytes };
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
/** Miro sends numbers as numbers or as strings ("24"). */
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(-1e7, Math.min(1e7, n)) : undefined;
};
const id = (v: unknown) => (typeof v === 'string' && /^[\w=+-]{1,64}$/.test(v) ? v : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : null);
/** '#RGB' / '#RRGGBB' (an alpha byte dropped, 'transparent' when it is 00), a Miro colour name, or undefined. */
function colour(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'transparent') return s;
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s) ?? /^#([0-9a-f]{3})$/.exec(s);
  if (hex) return hex[2] === '00' ? 'transparent' : `#${hex[1]}`;
  return /^[a-z_]{3,20}$/.test(s) ? s : undefined;
}
/** "50%" → 0.5, clamped to the box. */
const fraction = (v: unknown): number | undefined => {
  const m = typeof v === 'string' ? /^(-?\d+(?:\.\d+)?)%$/.exec(v.trim()) : null;
  return m ? Math.max(0, Math.min(1, Number(m[1]) / 100)) : undefined;
};
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
const httpLink = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) && v.length <= 2000 ? v : undefined);
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** One Miro item, or null when it has no id or type. `imageUrl` is kept aside (where its picture is). */
export function readItem(raw: unknown): { item: MiroItem; imageUrl: string | null } | null {
  const r = obj(raw);
  const itemId = id(r.id);
  const type = typeof r.type === 'string' && /^[a-z_]{1,40}$/.test(r.type) ? r.type : null;
  if (!itemId || !type) return null;
  const data = obj(r.data);
  const style = obj(r.style);
  const pos = obj(r.position);
  const g = obj(r.geometry);
  const parentId = id(obj(r.parent).id);
  const relative = pos.relativeTo === 'parent_top_left' && parentId;
  const w = num(g.width);
  const h = num(g.height);
  const title = text(data.title, MAX_TITLE);
  const content = type === 'card' || type === 'app_card' || type === 'frame' || type === 'image' || type === 'document' ? title : text(data.content);
  const item: MiroItem = defined({
    id: itemId,
    type,
    x: num(pos.x) ?? 0,
    y: num(pos.y) ?? 0,
    w: w !== undefined && w > 0 ? w : null,
    h: h !== undefined && h > 0 ? h : null,
    rotation: num(g.rotation) ?? 0,
    parentId: relative ? parentId : null,
    content,
    description: type === 'card' || type === 'app_card' ? text(data.description) : undefined,
    shape: typeof data.shape === 'string' && /^[a-z_]{1,40}$/.test(data.shape) ? data.shape : undefined,
    fill: colour(type === 'card' ? style.cardTheme : num(style.fillOpacity) === 0 ? 'transparent' : style.fillColor),
    color: colour(style.color),
    border: colour(style.borderColor),
    borderWidth: num(style.borderWidth),
    borderStyle: typeof style.borderStyle === 'string' ? style.borderStyle.slice(0, 20) : undefined,
    fontSize: num(style.fontSize),
    textAlign: typeof style.textAlign === 'string' ? style.textAlign.slice(0, 20) : undefined,
    dueDate: day(data.dueDate),
    tagIds: Array.isArray(r.tagIds) ? r.tagIds.map(id).filter((t): t is string => !!t).slice(0, 20) : undefined,
    link: type === 'embed' || type === 'preview' ? httpLink(data.url) : undefined,
  });
  // Where Miro said the picture is; the token goes there only at the API's own origin (service.ts).
  const imageUrl = type === 'image' && typeof data.imageUrl === 'string' ? data.imageUrl : null;
  return { item, imageUrl };
}

export function readConnector(raw: unknown): MiroConnector | null {
  const r = obj(raw);
  const cid = id(r.id);
  if (!cid) return null;
  const start = obj(r.startItem);
  const end = obj(r.endItem);
  const style = obj(r.style);
  const spot = (p: unknown) => {
    const o = obj(p);
    const u = fraction(o.x);
    const v = fraction(o.y);
    return u !== undefined && v !== undefined ? { u, v } : undefined;
  };
  const captions = Array.isArray(r.captions) ? r.captions : [];
  return defined({
    id: cid,
    from: id(start.id),
    to: id(end.id),
    fromAt: spot(start.position),
    toAt: spot(end.position),
    shape: r.shape === 'elbowed' || r.shape === 'curved' ? r.shape : 'straight',
    caption: text(obj(captions[0]).content, MAX_TITLE),
    color: colour(style.strokeColor),
    width: num(style.strokeWidth),
    style: typeof style.strokeStyle === 'string' ? style.strokeStyle.slice(0, 20) : undefined,
    startCap: typeof style.startStrokeCap === 'string' ? style.startStrokeCap.slice(0, 30) : undefined,
    endCap: typeof style.endStrokeCap === 'string' ? style.endStrokeCap.slice(0, 30) : undefined,
  });
}

export function readTag(raw: unknown): MiroTag | null {
  const r = obj(raw);
  const tid = id(r.id);
  const title = text(r.title, 120).trim();
  return tid && title ? { id: tid, title, color: colour(r.fillColor) ?? 'gray' } : null;
}

/** Every page of a cursor-paged list, until Miro has no more or `max` were read. `truncated`: there were more. */
export async function pages<T>(path: string, token: string, read: (raw: unknown) => T | null, max: number, deadline: number): Promise<{ list: T[]; truncated: boolean }> {
  const list: T[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let n = 0; n <= Math.ceil(max / PAGE); n++) {
    const q = new URLSearchParams({ limit: String(PAGE), ...(cursor ? { cursor } : {}) });
    const b = obj((await miroGet(`${path}?${q}`, token, deadline)).body);
    const data = Array.isArray(b.data) ? b.data : [];
    for (const raw of data) {
      if (list.length >= max) return { list, truncated: true };
      const v = read(raw);
      if (v) list.push(v);
    }
    const next = typeof b.cursor === 'string' ? b.cursor : '';
    // No cursor, an empty page, or a cursor seen before (a stand-in looping): the end.
    if (!next || !data.length || seen.has(next)) return { list, truncated: false };
    seen.add(next);
    cursor = next;
  }
  return { list, truncated: true };
}

export async function boardName(boardId: string, token: string, deadline: number): Promise<string> {
  const b = obj((await miroGet(`/v2/boards/${encodeURIComponent(boardId)}`, token, deadline)).body);
  return text(b.name, MAX_TITLE).trim() || 'Miro board';
}

export const boardItems = (boardId: string, token: string, deadline: number) => pages(`/v2/boards/${encodeURIComponent(boardId)}/items`, token, readItem, MIRO_MAX_ITEMS, deadline);
export const boardConnectors = (boardId: string, token: string, deadline: number) =>
  pages(`/v2/boards/${encodeURIComponent(boardId)}/connectors`, token, readConnector, MIRO_MAX_ITEMS, deadline);

/** The board's tags (offset-paged), at most MAX_TAGS. */
export async function boardTags(boardId: string, token: string, deadline: number): Promise<MiroTag[]> {
  const out: MiroTag[] = [];
  for (let offset = 0; offset < MAX_TAGS; offset += PAGE) {
    const b = obj((await miroGet(`/v2/boards/${encodeURIComponent(boardId)}/tags?limit=${PAGE}&offset=${offset}`, token, deadline)).body);
    const data = Array.isArray(b.data) ? b.data : [];
    for (const raw of data) {
      const t = readTag(raw);
      if (t && out.length < MAX_TAGS) out.push(t);
    }
    if (data.length < PAGE) break;
  }
  return out;
}
