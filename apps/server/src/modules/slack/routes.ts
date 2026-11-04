// The operator's Slack app (docs/integrations/slack.md). Off (404) unless SLACK_SIGNING_SECRET and
// SLACK_BOT_TOKEN are set; "Connect Slack" (#105) also needs SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.
//   POST /api/integrations/slack/events     the Events API request URL (docs.slack.dev/apis/events-api)
//   POST /api/integrations/slack/commands   /freero, the slash command's request URL
//   GET  /api/integrations/slack/me         the signed-in person's Slack link (DELETE: disconnect it)
//   GET  /api/integrations/slack/oauth/start, …/callback   "Connect Slack"
// Every request from Slack must carry a valid v0 signature from the last five minutes
// (signature.ts); the URL verification challenge is answered only then. `link_shared` is
// acknowledged at once (Slack wants a 2xx within three seconds) and answered with chat.unfurl
// afterwards (service.ts); a slash command is answered in the response.
import express, { Router, type Request, type Response } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle, notFound, rawBody } from '../../platform/http';
import { logger } from '../../platform/log';
import { rateLimit } from '../../platform/rateLimit';
import { allowCrossSitePost } from '../../platform/security';
import { currentUser, requireUser } from '../auth/index';
import { answerSlashCommand } from './commands';
import { forgetSlackTeam, slackAccountOf, slackConnectOffered, unlinkSlack } from './links';
import { finishSlackConnect, startSlackConnect } from './oauth';
import { answerLinkShared, type LinkSharedEvent } from './service';
import { checkSlackSignature } from './signature';

// Slack's servers post here: no browser, no cookie — the request signature is the only proof.
allowCrossSitePost(/^\/api\/integrations\/slack\/events$/, 'Slack Events API requests come from Slack’s servers and are verified by their v0 signature');
allowCrossSitePost(/^\/api\/integrations\/slack\/commands$/, 'Slack slash command requests come from Slack’s servers and are verified by their v0 signature');

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Whether the request is Slack's (its v0 signature over these exact bytes); answers 401 when not. */
function signedBySlack(secret: string, req: Request, res: Response, raw: Buffer | null): boolean {
  const check = checkSlackSignature(secret, {
    timestamp: header(req.headers['x-slack-request-timestamp']),
    signature: header(req.headers['x-slack-signature']),
    rawBody: raw,
  });
  if (check === 'ok') return true;
  logger.warn({ slack: { refused: check } }, 'slack request refused');
  res.status(401).json({ error: check === 'stale' ? 'Request timestamp is too old' : 'Invalid Slack signature' });
  return false;
}

export default function slackRoutes(ctx: ServerContext): Router {
  const r = Router();
  const slack = ctx.config.slack;

  // The settings page asks whether to show "Connect Slack" at all.
  r.get(
    '/integrations/slack/me',
    requireUser,
    handle(async (req, res) => {
      res.json(await slackAccountOf(currentUser(req).id));
    }),
  );

  if (!slack) return r;

  r.post(
    '/integrations/slack/events',
    handle(async (req, res) => {
      if (!signedBySlack(slack.signingSecret, req, res, rawBody(req))) return;
      const body = (req.body ?? {}) as { type?: string; challenge?: unknown; team_id?: string; event_id?: string; event?: { type?: string; tokens?: { bot?: unknown[] } } };
      if (body.type === 'url_verification') {
        res.json({ challenge: typeof body.challenge === 'string' ? body.challenge : '' });
        return;
      }
      res.status(200).end();
      if (body.type !== 'event_callback') return;
      const teamId = String(body.team_id ?? '');
      const type = body.event?.type;
      if (type === 'link_shared') void answerLinkShared(teamId, body.event_id, body.event as LinkSharedEvent);
      // The app is gone from a workspace: its token there and everyone's link with it.
      else if (type === 'app_uninstalled' || (type === 'tokens_revoked' && (body.event?.tokens?.bot?.length ?? 0) > 0))
        void forgetSlackTeam(teamId).catch((e) => logger.warn({ slack: { forgetTeam: teamId, error: String(e) } }, 'slack forget failed'));
    }),
  );

  r.post(
    '/integrations/slack/commands',
    // A slash command is a form post; its signature covers these exact bytes.
    express.raw({ type: 'application/x-www-form-urlencoded', limit: '16kb' }),
    handle(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : null;
      if (!signedBySlack(slack.signingSecret, req, res, raw)) return;
      res.json(await answerSlashCommand(new URLSearchParams(raw!.toString('utf8'))));
    }),
  );

  const offered = (_req: Request, _res: Response, next: (err?: unknown) => void) => next(slackConnectOffered() ? undefined : notFound('This server doesn’t offer Connect Slack'));
  r.get('/integrations/slack/oauth/start', requireUser, offered, rateLimit('oidc', 'ip'), handle((req, res) => startSlackConnect(req, res, currentUser(req).id)));
  r.get('/integrations/slack/oauth/callback', requireUser, offered, rateLimit('oidc', 'ip'), handle((req, res) => finishSlackConnect(req, res, currentUser(req).id)));
  r.delete(
    '/integrations/slack/me',
    requireUser,
    offered,
    handle(async (req, res) => {
      if (!(await unlinkSlack(currentUser(req).id))) throw notFound('No Slack account is connected');
      res.json({ ok: true });
    }),
  );
  return r;
}
