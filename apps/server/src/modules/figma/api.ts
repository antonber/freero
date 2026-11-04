// Figma's REST API (developers.figma.com/docs/rest-api), the few calls "Place from Figma" makes:
// the OAuth token endpoints, /v1/me, a file's pages and top-level frames, one node's size and name,
// and /v1/images, which renders frames and answers with short-lived links to the PNGs. Reached
// only at the configured `apiUrl` (api.figma.com; a stand-in in tests), with the person's token.
import { getConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';
import { safeFetch, UnfurlError } from '../unfurl/index';

const TIMEOUT_MS = 20_000;

/** Figma said no (or didn't answer). `status` is Figma's (0: unreachable). */
export class FigmaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function app() {
  const figma = getConfig().figma;
  if (!figma) throw new HttpError(404, 'This server doesn’t offer Place from Figma', 'figma_unavailable');
  return figma;
}

async function send(path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${app().apiUrl}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new FigmaApiError(0, 'Figma didn’t answer');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const b = (body ?? {}) as { err?: unknown; message?: unknown; error?: unknown };
    const m = [b.err, b.message, b.error].find((v): v is string => typeof v === 'string');
    throw new FigmaApiError(res.status, m ?? `Figma answered ${res.status}`);
  }
  return body;
}

const get = (path: string, token: string) => send(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });

/** The app's credentials as HTTP Basic auth, which Figma's token endpoints take. */
function tokenRequest(path: string, form: Record<string, string>) {
  const { clientId, clientSecret } = app();
  return send(path, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  });
}

export interface FigmaTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ms since the epoch, or null when Figma didn't say. */
  expiresAt: number | null;
}

function readTokens(body: unknown, now: number): FigmaTokens {
  const b = (body ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof b.access_token !== 'string' || !b.access_token) throw new FigmaApiError(502, 'Figma sent no access token');
  const expiresIn = Number(b.expires_in);
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
  };
}

export async function redeemCode(code: string, redirectUri: string, now = Date.now()): Promise<FigmaTokens> {
  return readTokens(await tokenRequest('/v1/oauth/token', { redirect_uri: redirectUri, code, grant_type: 'authorization_code' }), now);
}

export async function refreshTokens(refreshToken: string, now = Date.now()): Promise<FigmaTokens> {
  return readTokens(await tokenRequest('/v1/oauth/refresh', { refresh_token: refreshToken }), now);
}

export async function figmaMe(token: string): Promise<{ id: string; handle: string; email: string | null }> {
  const b = (await get('/v1/me', token)) as { id?: unknown; handle?: unknown; email?: unknown };
  if (typeof b?.id !== 'string' && typeof b?.id !== 'number') throw new FigmaApiError(502, 'Figma didn’t say who you are');
  const handle = typeof b.handle === 'string' && b.handle.trim() ? b.handle.trim().slice(0, 200) : String(b.id);
  return { id: String(b.id), handle, email: typeof b.email === 'string' ? b.email.slice(0, 320) : null };
}

/** What a picker can place: frames, components and sections at the top of a page. */
const PLACEABLE = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION']);

export interface FileFrames {
  name: string;
  thumbnail: string | null;
  frames: Array<{ id: string; name: string; page: string; w: number; h: number }>;
}

const clean = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const https = (v: unknown) => (typeof v === 'string' && v.startsWith('https://') ? v : null);

type Box = { width?: unknown; height?: unknown } | undefined;
const size = (b: Box) => ({ w: Math.max(1, Math.round(Number(b?.width) || 1)), h: Math.max(1, Math.round(Number(b?.height) || 1)) });

/** A file's name, thumbnail and the frames at the top of its pages (depth 2: pages and their children). */
export async function fileFrames(token: string, fileKey: string): Promise<FileFrames> {
  const b = (await get(`/v1/files/${encodeURIComponent(fileKey)}?depth=2`, token)) as {
    name?: unknown;
    thumbnailUrl?: unknown;
    document?: { children?: Array<{ name?: unknown; children?: Array<{ id?: unknown; name?: unknown; type?: unknown; absoluteBoundingBox?: Box }> }> };
  };
  const frames: FileFrames['frames'] = [];
  for (const page of b?.document?.children ?? []) {
    for (const n of page.children ?? []) {
      if (typeof n.id !== 'string' || !PLACEABLE.has(String(n.type))) continue;
      frames.push({ id: n.id, name: clean(n.name) || n.id, page: clean(page.name), ...size(n.absoluteBoundingBox) });
    }
  }
  return { name: clean(b?.name) || fileKey, thumbnail: https(b?.thumbnailUrl), frames };
}

/** One node's name and size, or null when the file has no such node. */
export async function nodeInfo(token: string, fileKey: string, nodeId: string): Promise<{ name: string; w: number; h: number } | null> {
  const b = (await get(`/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`, token)) as {
    nodes?: Record<string, { document?: { name?: unknown; absoluteBoundingBox?: Box } } | null>;
  };
  const doc = b?.nodes?.[nodeId]?.document;
  return doc ? { name: clean(doc.name) || nodeId, ...size(doc.absoluteBoundingBox) } : null;
}

/** Renders nodes as PNGs at `scale`: node id → a link to the picture (null where Figma couldn't). */
export async function renderNodes(token: string, fileKey: string, ids: string[], scale: number): Promise<Record<string, string | null>> {
  const q = new URLSearchParams({ ids: ids.join(','), format: 'png', scale: String(Math.min(4, Math.max(0.01, Math.round(scale * 1000) / 1000))) });
  const b = (await get(`/v1/images/${encodeURIComponent(fileKey)}?${q}`, token)) as { err?: unknown; images?: Record<string, unknown> };
  if (typeof b?.err === 'string' && b.err) throw new FigmaApiError(502, b.err);
  const out: Record<string, string | null> = {};
  for (const id of ids) {
    const u = b?.images?.[id];
    out[id] = typeof u === 'string' && /^https?:\/\//.test(u) ? u : null;
  }
  return out;
}

/** A render link is Figma's to give, but its host is whatever Figma said: only https, through the SSRF-safe fetch — except at the configured API's own origin (a stand-in). */
export function isTrustedRenderUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(app().apiUrl).origin;
  } catch {
    return false;
  }
}

/** A render's bytes (at most `maxBytes`). Throws FigmaApiError when it can't be fetched. */
export async function downloadRender(url: string, maxBytes: number): Promise<Buffer> {
  if (isTrustedRenderUrl(url)) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FigmaApiError(0, 'Figma’s render didn’t download');
    }
    if (!res.ok) throw new FigmaApiError(res.status, 'Figma’s render didn’t download');
    const body = Buffer.from(await res.arrayBuffer());
    // One byte over the cap is enough for the upload checks to refuse it as too large.
    return body.subarray(0, maxBytes + 1);
  }
  try {
    const res = await safeFetch(url, { maxBytes: maxBytes + 1, allowTruncate: true, timeoutMs: TIMEOUT_MS, accept: 'image/png', protocols: ['https:'] });
    return res.body;
  } catch (e) {
    if (e instanceof UnfurlError) throw new FigmaApiError(0, 'Figma’s render didn’t download');
    throw e;
  }
}
