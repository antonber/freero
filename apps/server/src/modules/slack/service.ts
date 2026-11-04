// Slack link unfurls (#88; docs/integrations/slack.md). The operator's Slack app sends `link_shared`
// for links to this instance's host; Freero answers with `chat.unfurl`
// (docs.slack.dev/reference/methods/chat.unfurl). What a preview may say is decided by boards'
// `publicLinkPreview`: a board ANYONE with the link may view (no account) shows its title, a short
// description and its thumbnail. A link posted by someone who connected their Slack account (#105)
// to a board or doc THEY can open shows its title (and a board's description and thumbnail) too —
// they chose to share it. Everything else — private boards, docs, boards that don't exist — gets
// the same generic card with no title, so a preview never tells whether a board exists or what it
// is called.
import { getConfig } from '../../platform/config';
import { logger, logError } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import { checkRateLimit } from '../../platform/rateLimit';
import { boardSummaryFor, publicLinkPreview } from '../boards/index';
import { isUploadRemoved } from '../uploads/index';
import { callSlack, mrkdwn, oneLine } from './api';
import { actingAsSlackFor, botTokenFor, linkedUserOf, slackReach } from './links';

const outcomes = counter('freero_slack_unfurls_total', 'Slack link_shared events by outcome', ['outcome'] as const);

export type UnfurlOutcome = 'unfurled' | 'no_links' | 'rate_limited' | 'duplicate' | 'slack_error' | 'failed';

export interface LinkSharedEvent {
  type: 'link_shared';
  channel: string;
  message_ts: string;
  links: Array<{ domain?: string; url: string }>;
  unfurl_id?: string;
  source?: string;
  /** The Slack user who posted the link. */
  user?: string;
}

/** The id of the board or doc a link of this instance opens, or null for any other link. */
export function linkTarget(url: string): { kind: 'board' | 'doc'; id: string } | null {
  let u: URL;
  let ours: URL;
  try {
    u = new URL(url);
    ours = new URL(appUrl(null, '/'));
  } catch {
    return null;
  }
  if (u.host !== ours.host) return null;
  const m = /^\/(board|doc)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(u.pathname);
  return m ? { kind: m[1] as 'board' | 'doc', id: m[2] } : null;
}

const GENERIC = {
  blocks: [
    { type: 'section', text: { type: 'mrkdwn', text: '*Freero board*\nSign in to Freero to view it.' } },
  ],
};

/**
 * What the poster may see of a board or doc they can open (#105), or null — also when its workspace
 * keeps apps out (API access off, the app blocked, an IP allowlist without an exemption for it).
 */
async function previewFor(target: { kind: 'board' | 'doc'; id: string }, userId: string, reach: (workspaceId: string) => Promise<boolean>) {
  try {
    const b = await actingAsSlackFor(userId, () => boardSummaryFor(target.id, userId, target.kind));
    if (!(await reach(b.workspaceId))) return null;
    return { title: b.title, description: target.kind === 'board' ? b.description : '', thumbnail: target.kind === 'board' ? b.thumbnail : null };
  } catch {
    return null; // no such board, no access, taken down: the generic card
  }
}

/**
 * The unfurl for one link (blocks), or null when it isn't a Freero board or doc link. `posterId`:
 * the Freero account of the Slack user who posted it, when they connected Slack.
 */
export async function unfurlFor(url: string, posterId: string | null = null, reach = posterId ? slackReach(posterId) : null): Promise<{ blocks: unknown[] } | null> {
  const target = linkTarget(url);
  if (!target) return null;
  const pub = target.kind === 'board' ? await publicLinkPreview(target.id) : null;
  const preview = pub ?? (posterId && reach ? await previewFor(target, posterId, reach) : null);
  if (!preview) return GENERIC;
  const what = target.kind === 'doc' ? 'doc' : 'board';
  const title = oneLine(preview.title || `Untitled ${what}`, 150);
  const description = oneLine(preview.description, 300) || `A ${what} on Freero`;
  // The picture is served without a session (an unguessable upload name); Slack fetches it itself,
  // so only from an https address, and never one an operator removed.
  const thumb = preview.thumbnail?.startsWith('/uploads/') ? preview.thumbnail : null;
  const image = thumb && !(await isUploadRemoved(thumb.replace(/^\/uploads\//, ''))) ? appUrl(null, thumb) : null;
  const section: Record<string, unknown> = { type: 'section', text: { type: 'mrkdwn', text: `*<${url}|${mrkdwn(title)}>*\n${mrkdwn(description)}` } };
  if (image?.startsWith('https://')) section.accessory = { type: 'image', image_url: image, alt_text: 'Board preview' };
  const who = pub ? 'anyone with the link can view' : 'only people with access can open it';
  return { blocks: [section, { type: 'context', elements: [{ type: 'mrkdwn', text: `Freero ${what} · ${who}` }] }] };
}

// Slack retries an event it thinks we missed (X-Slack-Retry-Num); one answer per event id is enough.
const seen = new Map<string, number>();
const SEEN_MS = 10 * 60_000;
function firstTime(eventId: string | undefined, now: number): boolean {
  if (!eventId) return true;
  for (const [id, at] of seen) if (now - at > SEEN_MS) seen.delete(id);
  if (seen.has(eventId)) return false;
  seen.set(eventId, now);
  return true;
}

/** Answers one `link_shared` event with `chat.unfurl`. Logged with its outcome; never throws. */
export async function answerLinkShared(teamId: string, eventId: string | undefined, event: LinkSharedEvent, now = Date.now()): Promise<UnfurlOutcome> {
  const slack = getConfig().slack;
  const done = (outcome: UnfurlOutcome, extra: Record<string, unknown> = {}) => {
    outcomes.inc({ outcome });
    logger.info({ slack: { event: 'link_shared', team: teamId, eventId, links: event.links?.length ?? 0, outcome, ...extra } }, 'slack unfurl');
    return outcome;
  };
  try {
    if (!slack) return done('failed', { reason: 'not configured' });
    if (!firstTime(eventId, now)) return done('duplicate');
    const unfurls: Record<string, unknown> = {};
    const posterId = await linkedUserOf(teamId, event.user);
    const reach = posterId ? slackReach(posterId) : null;
    for (const l of (event.links ?? []).slice(0, 10)) {
      if (typeof l?.url !== 'string') continue;
      const u = await unfurlFor(l.url, posterId, reach);
      if (u) unfurls[l.url] = u;
    }
    if (!Object.keys(unfurls).length) return done('no_links');
    const limit = await checkRateLimit('slackUnfurl', teamId);
    if (!limit.allowed) return done('rate_limited');
    const r = await callSlack('chat.unfurl', await botTokenFor(teamId), { channel: event.channel, ts: event.message_ts, unfurls });
    if (!r.ok) return done(r.error === 'request_failed' ? 'failed' : 'slack_error', { error: r.error ?? null });
    return done('unfurled', { unfurled: Object.keys(unfurls).length, ...(posterId ? { linked: true } : {}) });
  } catch (e) {
    logError('slack unfurl failed', e);
    return done('failed');
  }
}
