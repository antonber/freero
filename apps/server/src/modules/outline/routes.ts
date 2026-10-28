// GET /api/boards/:id/outline — the semantic board read model (contract: @freero/shared api.ts
// "Board outline"; format: docs/board-outline.md). Anyone who can open the board AND may export it
// under its workspace's downloads policy may read it (403 downloads_restricted otherwise, audited);
// what it contains follows their role (no private layers of others, no hidden frames' contents
// for viewers and commenters).
import { Router, type Request } from 'express';
import { OutlineSelectionError, type BoardOutlineResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { boardOutline, MAX_BUDGET, MAX_LIMIT, MIN_BUDGET, type OutlineQuery } from './service';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function intParam(req: Request, name: string, min: number, max: number): number | undefined {
  const raw = str(req.query[name]);
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

const flag = (req: Request, name: string, dflt: boolean) => {
  const v = str(req.query[name]);
  return v === undefined ? dflt : v === '1' || v === 'true';
};

export function parseOutlineQuery(req: Request): OutlineQuery {
  const format = str(req.query.format) ?? 'json';
  if (format !== 'json' && format !== 'markdown' && format !== 'md') throw badRequest('format must be json or markdown');
  const scope = str(req.query.scope);
  const cursor = str(req.query.cursor);
  if (scope !== undefined && (scope.length > 200 || !scope)) throw badRequest('Invalid scope');
  if (cursor !== undefined && cursor.length > 100) throw badRequest('Invalid cursor');
  return {
    format: format === 'json' ? 'json' : 'markdown',
    scope,
    cursor,
    limit: intParam(req, 'limit', 1, MAX_LIMIT),
    budget: intParam(req, 'budget', MIN_BUDGET, MAX_BUDGET),
    authors: flag(req, 'authors', false),
    comments: flag(req, 'comments', true),
  };
}

export default function outlineRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.get(
    '/boards/:id/outline',
    requireUser,
    rateLimit('outline', 'user'),
    handle(async (req, res) => {
      const q = parseOutlineQuery(req);
      const boardId = req.params.id;
      const etag = str(req.headers['if-none-match'])?.replace(/^W\//, '').replace(/"/g, '');
      let result;
      try {
        result = await boardOutline(boardId, currentUser(req).id, appUrl(req, `/board/${encodeURIComponent(boardId)}`), q, etag);
      } catch (e) {
        if (e instanceof OutlineSelectionError) throw badRequest(e.message);
        throw e;
      }
      res.setHeader('Cache-Control', 'private, no-cache');
      if (result === 'not-modified') {
        res.status(304).end();
        return;
      }
      res.setHeader('ETag', `W/"${result.outline.version}"`);
      if (result.markdown !== undefined) res.type('text/markdown; charset=utf-8').send(result.markdown);
      else res.json({ outline: result.outline } satisfies BoardOutlineResponse);
    }),
  );
  return r;
}
