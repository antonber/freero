// Typed object addresses (KAI-147, KAI-149). Every Freero thing other things can point at — a
// board, an item (or frame) on a board, a saved template, a workspace, a project, later a doc — is
// an object with a stable address:
//
//   freero://board/<boardId>                 a board
//   freero://board/<boardId>#<elementId>     an item or frame on that board
//   freero://template/<templateId>           a saved template
//   freero://workspace/<workspaceId>         a workspace
//   freero://project/<projectId>             a project (folder of boards)
//   freero://issue/<linkId>                  a tracker issue linked to items on a board (KAI-153)
//   freero://walkthrough/<id>                a recorded walkthrough of a board (KAI-133)
//   freero://decision/<id>                   a frozen, named copy of a board or frame (KAI-161)
//
// The web form of a board or item address is the page URL people already copy
// (`<origin>/board/<id>`, `?el=<elementId>`; a walkthrough's `?walkthrough=<id>`, a decision's
// `<origin>/decision/<id>`); `parseObjectUri` reads both, plus the same-origin paths item links
// store (`/board/<id>?el=…`). An address says WHAT, never whether anyone may see
// it: resolving one (`POST /api/objects/resolve`) is permission-checked for the reader every time.

export const OBJECT_TYPES = ['board', 'element', 'template', 'workspace', 'project', 'issue', 'walkthrough', 'decision'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export type ObjectRef =
  | { type: 'board'; id: string }
  /** An item or frame, addressed within its board. */
  | { type: 'element'; boardId: string; id: string }
  | { type: 'template'; id: string }
  | { type: 'workspace'; id: string }
  | { type: 'project'; id: string }
  /** A tracker issue linked to items on one board (modules/trackers): the link's id. */
  | { type: 'issue'; id: string }
  /** A recorded walkthrough of one board (modules/walkthroughs): voice, camera path, comments. */
  | { type: 'walkthrough'; id: string }
  /** A decision snapshot (modules/decisions): a board or frame frozen under a name. */
  | { type: 'decision'; id: string };

/** What someone may do with an object, weakest first. `can(view)` holds for anyone who may comment, etc. */
export const OBJECT_ACTIONS = ['view', 'comment', 'edit', 'manage'] as const;
export type ObjectAction = (typeof OBJECT_ACTIONS)[number];

export const OBJECT_URI_SCHEME = 'freero:';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const URI_TYPES = new Set<string>(['board', 'template', 'workspace', 'project', 'issue', 'walkthrough', 'decision']);

/** The canonical address of an object. */
export function formatObjectUri(ref: ObjectRef): string {
  if (ref.type === 'element') return `freero://board/${ref.boardId}#${ref.id}`;
  return `freero://${ref.type}/${ref.id}`;
}

/** A stable key for maps and sets (the canonical URI). */
export const objectKey = formatObjectUri;

/** The board an object lives on (a board is its own), or null for objects outside boards. */
export function boardOf(ref: ObjectRef): string | null {
  return ref.type === 'board' ? ref.id : ref.type === 'element' ? ref.boardId : null;
}

/**
 * Reads an object address: a `freero://` URI, a web URL of a board or item (`/board/<id>`,
 * `?el=` / `?item=`), or such a same-origin path. `origins`: the origins whose web URLs count as
 * Freero's (the app's own); a path without an origin always counts. Null for anything else.
 */
export function parseObjectUri(input: string, origins: readonly string[] = []): ObjectRef | null {
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;
  if (raw.toLowerCase().startsWith('freero://')) {
    const m = /^freero:\/\/([a-z]+)\/([^/?#\s]+)\/?(?:#([^\s]*))?$/i.exec(raw);
    if (!m) return null;
    const type = m[1].toLowerCase();
    const id = safeDecode(m[2]);
    const sub = m[3] ? safeDecode(m[3]) : '';
    if (!URI_TYPES.has(type) || !id || !ID.test(id)) return null;
    if (sub) {
      if (type !== 'board' || !ID.test(sub)) return null;
      return { type: 'element', boardId: id, id: sub };
    }
    return { type, id } as ObjectRef;
  }
  let url: URL;
  try {
    // Paths are resolved against a placeholder origin; only their path and query matter.
    url = raw.startsWith('/') && !raw.startsWith('//') ? new URL(raw, 'http://freero.invalid') : new URL(raw);
  } catch {
    return null;
  }
  const isPath = raw.startsWith('/') && !raw.startsWith('//');
  if (!isPath && !origins.includes(url.origin)) return null;
  const decision = /^\/decision\/([^/]+)\/?$/.exec(url.pathname);
  if (decision) {
    const id = safeDecode(decision[1]);
    return id && ID.test(id) ? { type: 'decision', id } : null;
  }
  const m = /^\/board\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  const boardId = safeDecode(m[1]);
  if (!boardId || !ID.test(boardId)) return null;
  const el = url.searchParams.get('el') ?? url.searchParams.get('item');
  if (el) return ID.test(el) ? { type: 'element', boardId, id: el } : null;
  const walkthrough = url.searchParams.get('walkthrough');
  if (walkthrough) return ID.test(walkthrough) ? { type: 'walkthrough', id: walkthrough } : null;
  return { type: 'board', id: boardId };
}

/** The app path that opens an object, or null when it has no page of its own (templates…). */
export function objectPath(ref: ObjectRef): string | null {
  if (ref.type === 'board') return `/board/${encodeURIComponent(ref.id)}`;
  if (ref.type === 'element') return `/board/${encodeURIComponent(ref.boardId)}?el=${encodeURIComponent(ref.id)}`;
  if (ref.type === 'decision') return `/decision/${encodeURIComponent(ref.id)}`;
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

/**
 * Every object address written in a piece of text (`freero://…` URIs, and web URLs / paths of
 * boards and items at `origins`), in order, without duplicates. Board content is untrusted, so
 * this never throws and caps what it returns.
 */
export function objectRefsInText(text: string, origins: readonly string[] = [], max = 200): ObjectRef[] {
  if (!text || (!text.includes('freero://') && !text.includes('/board/') && !text.includes('/decision/'))) return [];
  const out = new Map<string, ObjectRef>();
  // URIs, absolute URLs, and same-origin paths that start a token.
  const re = /freero:\/\/[^\s"'<>()[\]{}]+|https?:\/\/[^\s"'<>()[\]{}]+|(?<![\w/.:])\/(?:board|decision)\/[^\s"'<>()[\]{}]+/gi;
  for (const m of text.matchAll(re)) {
    const ref = parseObjectUri(m[0].replace(/[.,;:!?]+$/, ''), origins);
    if (ref) out.set(objectKey(ref), ref);
    if (out.size >= max) break;
  }
  return [...out.values()];
}

/** What a reader learns about an object they may see (`POST /api/objects/resolve`). */
export interface ObjectSummary {
  type: ObjectType;
  title: string;
  /** For an item: its element type ('sticky', 'frame', …). */
  kind?: string;
  /** For an item: the board it is on (the reader may see that board too). */
  board?: { id: string; title: string };
  /** A short text preview (an item's text, a template's description). */
  text?: string;
  /** A small picture (board thumbnail, template thumbnail): a same-origin /uploads URL. */
  image?: string | null;
  /** The app path that opens it, or null. */
  path: string | null;
  /** What the reader may do with it. */
  access: ObjectAction;
}

/**
 * One resolved address. `unavailable` covers both "no such object" and "you may not see it" on
 * purpose, and carries nothing else: an address in someone's content must not tell its readers
 * whether the target exists, or what it is called.
 */
export type ResolvedObject = { uri: string; status: 'ok'; object: ObjectSummary } | { uri: string; status: 'unavailable' } | { uri: string; status: 'invalid' };

export interface ResolveObjectsRequest {
  uris: string[];
}
export interface ResolveObjectsResponse {
  objects: ResolvedObject[];
}

/** How a source points at a target (references index, KAI-149). */
/** 'tracker': the item was sent to, or imported from, the tracker issue (KAI-153). */
export type ReferenceKind = 'link' | 'mention' | 'embed' | 'comment' | 'tracker';

/** "What links here": one source the reader may see, with how it points at the target. */
export interface Backlink {
  /** The source object (a board, or an item on one). */
  source: { uri: string; type: 'board' | 'element'; title: string; path: string; kind?: string };
  /** The board the source is on. */
  board: { id: string; title: string };
  kinds: ReferenceKind[];
  /** Exactly which target it points at (the board itself, or one of its items). */
  target: string;
}
export interface BacklinksResponse {
  backlinks: Backlink[];
}

/** Most addresses one resolve call takes. */
export const MAX_RESOLVE_URIS = 200;
