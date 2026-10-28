// Freero clipboard payload: travels through the system clipboard as text/html (with an
// attribute carrying base64 JSON) + text/plain, so copy/paste works across boards and tabs.
import type { BoardElement } from '@freero/shared';
import type { Point } from '../api';
import { boundsOf, rectCenter } from '../geometry/geometry';

export const CLIPBOARD_ATTR = 'data-freero-clipboard';

export interface ClipboardPayload {
  app: 'freero';
  version: 1;
  boardId: string;
  elements: BoardElement[];
  /**
   * [additive] Per source element id: content it keeps outside the elements map
   * (ElementDefinition.copyContent, e.g. table cells), handed to pasteContent of each copy.
   */
  content?: Record<string, unknown>;
}

export interface ClipboardMemory {
  payload: ClipboardPayload;
  text: string;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function serializeClipboard(payload: ClipboardPayload, plainText: string): { html: string; text: string } {
  const data = toBase64(JSON.stringify(payload));
  const body = plainText ? escapeHtml(plainText).replace(/\n/g, '<br>') : '&nbsp;';
  return {
    html: `<meta charset="utf-8"><span ${CLIPBOARD_ATTR}="${data}">${body}</span>`,
    text: plainText,
  };
}

export function parseClipboardHtml(html: string | null | undefined): ClipboardPayload | null {
  if (!html) return null;
  const m = html.match(new RegExp(`${CLIPBOARD_ATTR}="([A-Za-z0-9+/=]+)"`));
  if (!m) return null;
  try {
    const p = JSON.parse(fromBase64(m[1])) as ClipboardPayload;
    if (p && p.app === 'freero' && Array.isArray(p.elements)) return p;
  } catch {
    // not ours / corrupted
  }
  return null;
}

/**
 * Gives every element a fresh id and rewrites references between them (frameId, groupId,
 * connector endpoints, mind-map parents…): any string field anywhere in the element that equals
 * an old id is replaced. Group ids get fresh ids too. References to elements outside the set
 * are cleared for frameId / attachedTo and kept elsewhere (e.g. a connector to an element still on the board).
 */
export function remapElements(
  elements: BoardElement[],
  newId: () => string,
): { elements: BoardElement[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  for (const el of elements) idMap.set(el.id, newId());
  const groupMap = new Map<string, string>();
  for (const el of elements) if (el.groupId && !groupMap.has(el.groupId)) groupMap.set(el.groupId, newId());

  const rewrite = (v: unknown): unknown => {
    if (typeof v === 'string') return idMap.get(v) ?? v;
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) o[k] = rewrite(val);
      return o;
    }
    return v;
  };

  const out = elements.map((el) => {
    const copy = rewrite(el) as BoardElement;
    copy.id = idMap.get(el.id)!;
    if (el.frameId && !idMap.has(el.frameId)) copy.frameId = null;
    if (el.attachedTo && !idMap.has(el.attachedTo)) copy.attachedTo = null;
    if (el.groupId) copy.groupId = groupMap.get(el.groupId)!;
    return copy;
  });
  return { elements: out, idMap };
}

/** Translates elements by (dx, dy), including nested point lists that are absolute (connector endpoints). */
export function translateElement<T extends BoardElement>(el: T, dx: number, dy: number): T {
  const out = { ...el, x: el.x + dx, y: el.y + dy } as T;
  if (el.type === 'connector') {
    const c = el as Extract<BoardElement, { type: 'connector' }>;
    (out as typeof c).start = { ...c.start, x: c.start.x + dx, y: c.start.y + dy };
    (out as typeof c).end = { ...c.end, x: c.end.x + dx, y: c.end.y + dy };
    if (c.waypoints) (out as typeof c).waypoints = c.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return out;
}

/** Moves a set of elements so the center of their bounds lands on `at`. */
export function placeAt(elements: BoardElement[], at: Point): BoardElement[] {
  const b = boundsOf(elements);
  if (!b) return elements;
  const c = rectCenter(b);
  const dx = Math.round(at.x - c.x);
  const dy = Math.round(at.y - c.y);
  return elements.map((el) => translateElement(el, dx, dy));
}
