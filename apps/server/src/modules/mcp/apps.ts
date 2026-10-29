// MCP Apps (io.modelcontextprotocol/ui, KAI-171): the interactive views hosts such as Claude,
// ChatGPT and VS Code render for Freero's tool results, in a sandboxed frame under a CSP built from
// each resource's `_meta.ui.csp`. Hosts without the extension ignore them and show the text result.
//
//   ui://freero/board-preview.html  read-only drawing of the outline a get_board_outline result
//                                   carries; declares NO domains, so it can't reach the network.
//   ui://freero/board-live.html     frames Freero's own board page (/embed/board/:id) with the
//                                   single-use ticket an open_board result carries for the view
//                                   only (`_meta`); `frameDomains` = Freero's origin, nothing else.
//
// The views are static, self-contained HTML (views/: no build step, no third-party code) and carry
// no board data themselves: hosts may prefetch and review them.
import fs from 'node:fs';
import type { Request } from 'express';
import type { McpServer } from '@modelcontextprotocol/server';
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { STICKY_COLORS } from '@freero/shared';
import { appUrl } from '../../platform/mail';

export const PREVIEW_URI = 'ui://freero/board-preview.html';
export const LIVE_URI = 'ui://freero/board-live.html';

const view = (name: string) => fs.readFileSync(new URL(`./views/${name}`, import.meta.url), 'utf8');
const bridge = view('bridge.js');
const PREVIEW_HTML = view('preview.html').replace('/*FREERO_BRIDGE*/', () => bridge).replace('/*FREERO_PALETTE*/ {}', () => JSON.stringify(STICKY_COLORS));
const LIVE_HTML = view('live.html').replace('/*FREERO_BRIDGE*/', () => bridge);

/** Freero's own origin as the person's assistant reaches it (PUBLIC_URL, else the request's). */
export const freeroOrigin = (req: Request) => new URL(appUrl(req, '/')).origin;

export function registerViews(server: McpServer, req: Request): void {
  const previewMeta = { ui: { prefersBorder: true } };
  registerAppResource(
    server,
    'board-preview',
    PREVIEW_URI,
    { title: 'Board preview', description: 'A read-only drawing of a Freero board outline. Makes no network requests.', _meta: previewMeta },
    async () => ({ contents: [{ uri: PREVIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: PREVIEW_HTML, _meta: previewMeta }] }),
  );
  const origin = freeroOrigin(req);
  const liveMeta = {
    ui: { csp: { frameDomains: [origin], connectDomains: [], resourceDomains: [] }, prefersBorder: true },
    // ChatGPT's earlier Apps SDK keys, for hosts that still read them.
    'openai/widgetCSP': { frame_domains: [origin], connect_domains: [], resource_domains: [] },
    'openai/widgetPrefersBorder': true,
  };
  registerAppResource(
    server,
    'board-live',
    LIVE_URI,
    { title: 'Live board', description: 'A Freero board, live: frames the board page on Freero’s own origin with a short-lived, single-use ticket.', _meta: liveMeta },
    async () => ({ contents: [{ uri: LIVE_URI, mimeType: RESOURCE_MIME_TYPE, text: LIVE_HTML, _meta: liveMeta }] }),
  );
}
