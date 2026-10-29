// POST /api/integrations/slack/events — the Slack Events API request URL of the operator's Slack app
// (docs.slack.dev/apis/events-api). Off (404) unless SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN are set.
// Every request must carry a valid v0 signature from the last five minutes (signature.ts); the
// URL verification challenge is answered only then. `link_shared` is acknowledged at once (Slack
// wants a 2xx within three seconds) and answered with chat.unfurl afterwards (service.ts).
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle, rawBody } from '../../platform/http';
import { logger } from '../../platform/log';
import { allowCrossSitePost } from '../../platform/security';
import { answerLinkShared, type LinkSharedEvent } from './service';
import { checkSlackSignature } from './signature';

// Slack's servers post here: no browser, no cookie — the request signature is the only proof.
allowCrossSitePost(/^\/api\/integrations\/slack\/events$/, 'Slack Events API requests come from Slack’s servers and are verified by their v0 signature');

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function slackRoutes(ctx: ServerContext): Router {
  const r = Router();
  const slack = ctx.config.slack;
  if (!slack) return r;
  r.post(
    '/integrations/slack/events',
    handle(async (req, res) => {
      const check = checkSlackSignature(slack.signingSecret, {
        timestamp: header(req.headers['x-slack-request-timestamp']),
        signature: header(req.headers['x-slack-signature']),
        rawBody: rawBody(req),
      });
      if (check !== 'ok') {
        logger.warn({ slack: { refused: check } }, 'slack request refused');
        res.status(401).json({ error: check === 'stale' ? 'Request timestamp is too old' : 'Invalid Slack signature' });
        return;
      }
      const body = (req.body ?? {}) as { type?: string; challenge?: unknown; team_id?: string; event_id?: string; event?: { type?: string } };
      if (body.type === 'url_verification') {
        res.json({ challenge: typeof body.challenge === 'string' ? body.challenge : '' });
        return;
      }
      res.status(200).end();
      if (body.type === 'event_callback' && body.event?.type === 'link_shared')
        void answerLinkShared(String(body.team_id ?? ''), body.event_id, body.event as LinkSharedEvent);
    }),
  );
  return r;
}
