// GET /api/search?q=&workspace=&board=&limit=&cursor= — the dashboard's search inside boards:
// matches in boards the caller can open now, with snippets of what every reader of the board sees.
import { Router } from 'express';
import type { SearchResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { searchFor } from './service';

export default function searchRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.get(
    '/search',
    requireUser,
    rateLimit('search', 'user'),
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json((await searchFor({ userId: currentUser(req).id }, req.query)) satisfies SearchResponse);
    }),
  );
  return r;
}
