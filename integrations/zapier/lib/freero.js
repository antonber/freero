// What every part of Freero's Zapier app shares: the instance it talks to, board ids from links,
// and the webhook signature check (docs/events.md "Delivery").
'use strict';

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://freero.app';

/** The Freero instance of this connection: an https origin (http only for a local one). */
function baseUrl(bundle) {
  const raw = String((bundle.authData && bundle.authData.baseUrl) || (bundle.inputData && bundle.inputData.baseUrl) || DEFAULT_BASE_URL).trim();
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    throw new Error(`"${raw}" is not a web address. Use your Freero's address, such as ${DEFAULT_BASE_URL}.`);
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('Freero must be reached over https.');
  return u.origin;
}

const api = (bundle, path) => `${baseUrl(bundle)}/api/v1${path}`;

/** A board id, from the id itself or any Freero link to the board (its page, its embed, an item's copied link). */
function boardId(value) {
  const v = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(v)) return v;
  try {
    const m = /\/(?:board|embed\/b|teams\/b|atlassian\/b|zoom\/b|meet\/stage)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(new URL(v).pathname);
    if (m) return m[1];
  } catch (e) {
    /* not a link */
  }
  throw new Error('Give a board: pick one, or paste its link (…/board/<id>).');
}

/** A header of a hook's raw request, whatever case or "Http-" prefix Zapier gives it. */
function header(rawRequest, name) {
  const headers = (rawRequest && rawRequest.headers) || {};
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase().replace(/^http-/, '');
    if (key === want) return Array.isArray(v) ? v[0] : String(v);
  }
  return '';
}

/**
 * Whether `body` (the exact bytes Freero sent) carries a valid `Freero-Signature` for `secret`:
 * HMAC-SHA256 over "<t>.<body>", compared in constant time, at most five minutes old.
 */
function validSignature(secret, signature, body, now = Date.now()) {
  if (!secret || !signature) return false;
  const f = {};
  for (const part of String(signature).split(',')) {
    const i = part.indexOf('=');
    if (i > 0) f[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const t = Number(f.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(f.v1 || '') || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(f.v1, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Freero's event as Zapier shows it: flat fields for mapping (docs/events.md), its id for deduplication. */
function flattenEvent(e) {
  const d = e.data || {};
  const item = d.item || {};
  return {
    id: e.id,
    type: e.type,
    created_at: e.createdAt,
    workspace_id: e.workspaceId,
    board_id: (e.board && e.board.id) || '',
    board_title: (e.board && e.board.title) || '',
    board_url: (e.board && e.board.url) || '',
    actor_kind: (e.actor && e.actor.kind) || '',
    actor_name: (e.actor && e.actor.name) || '',
    item_id: item.id || d.itemId || '',
    item_type: item.type || '',
    container_id: item.containerId || d.containerId || '',
    text: d.text || item.text || d.title || '',
    thread_id: d.threadId || '',
    data: d,
  };
}

module.exports = { DEFAULT_BASE_URL, baseUrl, api, boardId, header, validSignature, flattenEvent };
