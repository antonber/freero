// Slack link unfurls (#88; docs/integrations/slack.md). The operator's Slack app sends `link_shared`
// for links to this instance's host; Freero answers with `chat.unfurl`
// (docs.slack.dev/reference/methods/chat.unfurl). What a preview may say is decided by boards'
// `publicLinkPreview`: a board ANYONE with the link may view (no account) shows its title, a short
// description and its thumbnail; everything else — private boards, docs, boards that don't exist —
// gets the same generic card with no title, so a preview never tells whether a board exists or
// what it is called.
import { getConfig } from '../../platform/config';
import { logger, logError } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import { checkRateLimit } from '../../platform/rateLimit';
import { publicLinkPreview } from '../boards/index';
import { isUploadRemoved } from '../uploads/index';

const outcomes = counter('freero_slack_unfurls_total', 'Slack link_shared events by outcome', ['outcome'] as const);

export type UnfurlOutcome = 'unfurled' | 'no_links' | 'rate_limited' | 'duplicate' | 'slack_error' | 'failed';

export interface LinkSharedEvent {
  type: 'link_shared';
  channel: string;
  message_ts: string;
  links: Array<{ domain?: string; url: string }>;
  unfurl_id?: string;
  source?: string;
}

/** Slack mrkdwn: `&`, `<` and `>` are its only control characters (docs.slack.dev, "Formatting text"). */
const mrkdwn = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

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

/** The unfurl for one link (blocks), or null when it isn't a Freero board or doc link. */
export async function unfurlFor(url: string): Promise<{ blocks: unknown[] } | null> {
  const target = linkTarget(url);
  if (!target) return null;
  const preview = target.kind === 'board' ? await publicLinkPreview(target.id) : null;
  if (!preview) return GENERIC;
  const title = oneLine(preview.title || 'Untitled board', 150);
  const description = oneLine(preview.description, 300) || 'A board on Freero';
  // The picture is served without a session (an unguessable upload name); Slack fetches it itself,
  // so only from an https address, and never one an operator removed.
  const image = preview.thumbnail && !(await isUploadRemoved(preview.thumbnail.replace(/^\/uploads\//, ''))) ? appUrl(null, preview.thumbnail) : null;
  const section: Record<string, unknown> = { type: 'section', text: { type: 'mrkdwn', text: `*<${url}|${mrkdwn(title)}>*\n${mrkdwn(description)}` } };
  if (image?.startsWith('https://')) section.accessory = { type: 'image', image_url: image, alt_text: 'Board preview' };
  return { blocks: [section, { type: 'context', elements: [{ type: 'mrkdwn', text: 'Freero board · anyone with the link can view' }] }] };
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
    for (const l of (event.links ?? []).slice(0, 10)) {
      if (typeof l?.url !== 'string') continue;
      const u = await unfurlFor(l.url);
      if (u) unfurls[l.url] = u;
    }
    if (!Object.keys(unfurls).length) return done('no_links');
    const limit = await checkRateLimit('slackUnfurl', teamId);
    if (!limit.allowed) return done('rate_limited');
    const res = await fetch(`${slack.apiUrl}/chat.unfurl`, {
      method: 'POST',
      headers: { authorization: `Bearer ${slack.botToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: event.channel, ts: event.message_ts, unfurls }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !body?.ok) return done('slack_error', { status: res.status, error: body?.error ?? null });
    return done('unfurled', { unfurled: Object.keys(unfurls).length });
  } catch (e) {
    logError('slack unfurl failed', e);
    return done('failed');
  }
}
