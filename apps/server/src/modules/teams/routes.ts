// Microsoft Teams and Microsoft 365 Copilot (#112, #113, #114; docs/integrations/teams.md). Off
// unless the operator sets the ids (platform/config `teams`, `copilot`):
//
//   GET  /teams/config                     the tab's configuration page (pick a board) — framed by Teams
//   GET  /teams/b/:id                      the tab / meeting side panel / stage: the board's public
//                                          embed, framed by Teams while the board allows embedding
//   GET  /teams/choose                     the sign-in window that lists your boards (never framed)
//   POST /api/integrations/teams/messages  the Azure Bot's messaging endpoint: link previews (bot.ts),
//                                          Bot Connector JWT required (botAuth.ts)
//   GET  /api/integrations/teams/app-package     the Teams app package (zip) of this instance
//   GET  /api/integrations/copilot/agent-package the Copilot agent package (zip) of this instance
//   GET  /api/integrations/microsoft       which of them this instance offers (operator console)
//
// Framing: the Teams pages get `frame-ancestors` = Microsoft's documented Teams / Microsoft 365
// hosts only (never '*'), and only when the Teams app is set up; everything else keeps
// frame-ancestors 'none'. They act on no session cookie: a board signs in through the public
// embed's board-bound token (modules/embed), minted in a first-party window Teams opens.
// In development Vite serves the pages and sets no framing headers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type Response } from 'express';
import type { MicrosoftIntegrationsInfo } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle, HttpError } from '../../platform/http';
import { logger } from '../../platform/log';
import { allowCrossSitePost, allowOpener, frameFromOrigins } from '../../platform/security';
import { boardEmbedding } from '../boards/index';
import { answerQueryLink, QUERY_LINK_INVOKES, type TeamsActivity } from './bot';
import { BotTokenValidator } from './botAuth';
import { COPILOT_PACKAGE_PATH, copilotAgentPackage } from './copilot';
import { packageOrigin, SEMVER, TEAMS_APP_VERSION, TEAMS_MESSAGES_PATH, TEAMS_PACKAGE_PATH, teamsAppPackage } from './manifest';

export const mountPath = '/';

/**
 * Who may frame the Teams pages: Teams on the web and desktop, and Microsoft 365 hosts that run
 * Teams apps — the frame-ancestors Microsoft documents for tabs
 * (learn.microsoft.com/microsoftteams/platform/tabs/how-to/tab-requirements).
 */
export const TEAMS_FRAME_ANCESTORS = ['https://teams.microsoft.com', 'https://*.teams.microsoft.com', 'https://*.cloud.microsoft', 'https://*.office.com', 'https://*.microsoft365.com'] as const;

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The Bot Connector service posts here from Microsoft's servers: no browser, no cookie — its JWT is the only proof.
allowCrossSitePost(/^\/api\/integrations\/teams\/messages$/, 'Bot Framework activities come from Microsoft’s Bot Connector service and are verified by its signed JWT');

export default function teamsRoutes(ctx: ServerContext): Router {
  // The board chooser Teams opens with authentication.authenticate() talks to Teams through
  // window.opener (the Teams JavaScript library), which a same-origin opener policy would cut.
  allowOpener(/^\/teams\/choose$/, 'The Teams board chooser hands its result to Teams (its opener) through the Teams JavaScript library, which accepts only Teams origins');

  const r = Router();
  const { teams, copilot } = ctx.config;
  const indexHtml = path.join(ctx.config.webDist, 'index.html');
  const appPage = () => fs.readFile(indexHtml, 'utf8').catch(() => null);
  const framedByTeams = (req: Parameters<typeof frameFromOrigins>[0], res: Response) =>
    frameFromOrigins(req, res, ctx.config, TEAMS_FRAME_ANCESTORS, 'Microsoft Teams frames its app’s pages; they use no session cookie and sign in with a board-bound embed token');

  r.get(
    '/api/integrations/microsoft',
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        teams: teams ? { packageUrl: TEAMS_PACKAGE_PATH, linkPreviews: !!teams.bot } : null,
        copilot: copilot ? { packageUrl: COPILOT_PACKAGE_PATH } : null,
      } satisfies MicrosoftIntegrationsInfo);
    }),
  );

  if (teams) {
    r.get(
      TEAMS_PACKAGE_PATH,
      handle(async (req, res) => {
        const origin = originForPackage(ctx.config.publicUrl);
        const version = versionOf(req.query.version);
        sendZip(res, `freero-teams-${new URL(origin).hostname}-${version}.zip`, teamsAppPackage(origin, teams, version));
      }),
    );

    r.get(
      '/teams/config',
      handle(async (req, res, next) => {
        const html = await appPage();
        if (html === null) return next();
        framedByTeams(req, res);
        sendPage(res, html);
      }),
    );
    r.get(
      '/teams/b/:id',
      handle(async (req, res, next) => {
        const html = await appPage();
        if (html === null) return next();
        // Exactly the public embed's rule: framed only while the board allows embedding.
        if (BOARD_ID.test(req.params.id) && (await boardEmbedding(req.params.id))) framedByTeams(req, res);
        sendPage(res, html);
      }),
    );

    const bot = teams.bot;
    if (bot) {
      const validator = new BotTokenValidator(bot.id, bot.openIdMetadataUrl);
      r.post(
        TEAMS_MESSAGES_PATH,
        handle(async (req, res) => {
          const activity = (req.body && typeof req.body === 'object' ? req.body : {}) as TeamsActivity;
          const auth = await validator.validate(req.headers.authorization, activity);
          if (!auth.ok) {
            logger.warn({ teams: { refused: auth.reason, type: activity.type, name: activity.name } }, 'teams bot request refused');
            res.status(auth.status).json({ error: auth.status === 403 ? 'Forbidden' : 'Unauthorized' });
            return;
          }
          if (activity.channelId !== 'msteams') return void res.status(200).end();
          if (activity.type === 'invoke') {
            if ((QUERY_LINK_INVOKES as readonly string[]).includes(activity.name ?? '')) return void res.status(200).json(await answerQueryLink(activity));
            // An invoke this bot doesn't handle (Teams then says the app couldn't answer).
            return void res.status(501).json({});
          }
          // Messages, installs, conversation updates: nothing to answer.
          res.status(200).end();
        }),
      );
    }
  }

  if (copilot) {
    r.get(
      COPILOT_PACKAGE_PATH,
      handle(async (req, res) => {
        const origin = originForPackage(ctx.config.publicUrl);
        const version = versionOf(req.query.version);
        sendZip(res, `freero-copilot-${new URL(origin).hostname}-${version}.zip`, copilotAgentPackage(origin, copilot, version));
      }),
    );
  }
  return r;
}

/** `?version=` (semver, for an update Teams accepts) or the default. */
function versionOf(v: unknown): string {
  if (v === undefined || v === '') return TEAMS_APP_VERSION;
  if (typeof v !== 'string' || !SEMVER.test(v)) throw badRequest('version must look like 1.2.3');
  return v;
}

/** The https origin a package points at; 409 naming what to set when there is none. */
function originForPackage(publicUrl: string | null): string {
  try {
    return packageOrigin(publicUrl);
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
}

function sendZip(res: Response, filename: string, zip: Uint8Array): void {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(Buffer.from(zip));
}

/** The app page as main.ts's SPA fallback sends it. */
function sendPage(res: Response, html: string): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
}
