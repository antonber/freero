// Board import from another whiteboard's API (#62; docs/design/importers.md): the bounds one import
// keeps to, and reading a Miro board link. Wire types are in api.ts ("Board import from Miro").
// Pure: no imports.

/** At most this many items, and as many connectors, in one import (the file importers' cap too). */
export const MIRO_MAX_ITEMS = 2000;
/** At most this many pictures copied in one import. */
export const MIRO_MAX_IMAGES = 100;

const ID = /^[A-Za-z0-9_\-=+]{6,64}$/;

/** A Miro board's id from its link (miro.com/app/board/<id>/…) or the id itself; null for anything else. */
export function miroBoardId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  const s = raw.trim();
  if (ID.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !/(^|\.)miro\.com$/i.test(u.hostname)) return null;
  const m = /^\/app\/(?:board|live-embed)\/([^/]+)/.exec(u.pathname);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return ID.test(id) ? id : null;
}
