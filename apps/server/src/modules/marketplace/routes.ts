// Community listings (#87; contract: @freero/shared integrations.ts). Signed in only: the listings
// live in the app, never on the public site. Operators review them in the moderation console
// (modules/moderation), which is where every decision is taken and recorded.
import { Router, type Response } from 'express';
import type { CommunityListing, OwnListing } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { listingFor, liveListings, ownListings, submitListing, withdrawListing } from './service';

const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store');

export default function marketplaceRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/marketplace/listings',
    requireUser,
    handle(async (_req, res) => {
      noStore(res);
      res.json({ listings: await liveListings() } satisfies { listings: CommunityListing[] });
    }),
  );
  r.get(
    '/marketplace/listings/mine',
    requireUser,
    handle(async (req, res) => {
      noStore(res);
      res.json({ listings: await ownListings(currentUser(req).id) } satisfies { listings: OwnListing[] });
    }),
  );
  r.get(
    '/marketplace/listings/:id',
    requireUser,
    handle(async (req, res) => {
      noStore(res);
      res.json({ listing: await listingFor(req.params.id, currentUser(req).id) });
    }),
  );
  r.post(
    '/marketplace/listings',
    requireUser,
    rateLimit('listingSubmit', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ listing: await submitListing(currentUser(req), (req.body ?? {}) as Record<string, unknown>) } satisfies { listing: OwnListing });
    }),
  );
  r.delete(
    '/marketplace/listings/:id',
    requireUser,
    handle(async (req, res) => {
      await withdrawListing(currentUser(req).id, req.params.id);
      res.json({ ok: true });
    }),
  );
  return r;
}
