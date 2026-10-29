// The doc app's own routes (KAI-162). Everything a doc shares with a board — reading its summary,
// renaming, sharing, members, link, trash, versions, request access — is served by the boards,
// members and realtime routes under /api/boards/:id (a doc is a container like a board); these are
// what only a document has. Contract: @freero/shared api.ts "Docs".
import { Router } from 'express';
import type { CreateDocResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { createDoc, exportDocMarkdown } from './service';

/** A file name for a download: the title's safe characters (RFC 5987 for the rest). */
function fileName(title: string): { ascii: string; utf8: string } {
  const base = title.trim().slice(0, 80) || 'doc';
  return { ascii: `${base.replace(/[^\w .-]+/g, '_')}.md`, utf8: encodeURIComponent(`${base}.md`) };
}

export default function docRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.post(
    '/docs',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const doc = await createDoc(currentUser(req).id, body);
      res.status(201).json({ doc } satisfies CreateDocResponse);
    }),
  );

  r.get(
    '/docs/:id/markdown',
    requireUser,
    handle(async (req, res) => {
      const { title, markdown } = await exportDocMarkdown(req.params.id, currentUser(req).id, 'export');
      const name = fileName(title);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name.ascii}"; filename*=UTF-8''${name.utf8}`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(markdown);
    }),
  );

  return r;
}
