// Figma frames on boards (#171 the picker, #172 the plugin). A frame placed from Figma is an
// ordinary image whose item link (`BaseElement.link`) points back at the frame: the link is what
// "Refresh from Figma" reads, and what the plugin's re-send matches, so neither needs a field of
// its own on the image. Pure: no imports.

export interface FigmaFrameRef {
  fileKey: string;
  /** Figma's node id as its API writes it, "12:34". */
  nodeId: string;
}

const KEY = /^[A-Za-z0-9]{10,64}$/;
const NODE = /^(\d{1,10})[:-](\d{1,10})$/;

/** "12:34" from "12:34" or "12-34" (how links write it); null for anything else. */
export function figmaNodeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = NODE.exec(raw.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

export const isFigmaFileKey = (raw: unknown): raw is string => typeof raw === 'string' && KEY.test(raw);

/** The link back to a frame, as Figma's own "Copy link to selection" writes it. */
export function figmaFrameLink(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(':', '-')}`;
}

/**
 * A Figma design file link (figma.com/design|file|proto/<key>/…, a branch's key when it names
 * one) and the node it points at, if any. Null for anything that isn't one.
 */
export function parseFigmaLink(url: unknown): { fileKey: string; nodeId: string | null } | null {
  if (typeof url !== 'string' || url.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !(u.hostname === 'figma.com' || u.hostname.endsWith('.figma.com'))) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (!['design', 'file', 'proto'].includes(parts[0] ?? '')) return null;
  const fileKey = parts[2] === 'branch' && parts[3] ? parts[3] : parts[1];
  if (!isFigmaFileKey(fileKey)) return null;
  return { fileKey, nodeId: figmaNodeId(u.searchParams.get('node-id')) };
}

/** The frame a link points at, or null (not a Figma link, or a whole file). */
export function parseFigmaFrameLink(url: unknown): FigmaFrameRef | null {
  const p = parseFigmaLink(url);
  return p?.nodeId ? { fileKey: p.fileKey, nodeId: p.nodeId } : null;
}

/** Both links point at the same Figma frame (whatever else their URLs say), or are the same link. */
export function sameFigmaFrame(a: string, b: string): boolean {
  if (a === b) return true;
  const x = parseFigmaFrameLink(a);
  const y = parseFigmaFrameLink(b);
  return !!x && !!y && x.fileKey === y.fileKey && x.nodeId === y.nodeId;
}
