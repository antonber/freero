// Direct messages to people who connected Slack (#105): written by the app's bot in its direct
// message with them (chat.postMessage to the channel conversations.open gave at connect time).
// modules/notifications decides what is sent and when; this only words it for Slack. Untrusted
// text (titles, excerpts) is escaped, so it can't make links or @channel pings.
import { logger } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import { callSlack, mrkdwn, oneLine } from './api';
import { botTokenFor, slackConnectOffered } from './links';
import * as repo from './repo';

const sent = counter('freero_slack_dms_total', 'Direct messages Freero tried to send in Slack, by outcome', ['outcome'] as const);

export interface SlackDm {
  /** The headline, plain text ("Ann mentioned you in “Roadmap”"). */
  title: string;
  /** A quote under it (a comment's excerpt), plain text. */
  quote?: string;
  /** Absolute URL it opens, and that link's words. */
  url: string;
  linkLabel: string;
}

export type SlackDmOutcome = 'sent' | 'not_linked' | 'failed';

/** Sends the message to the person's Slack, if they connected one. Never throws. */
export async function sendSlackDm(userId: string, m: SlackDm): Promise<SlackDmOutcome> {
  if (!slackConnectOffered()) return 'not_linked';
  const link = await repo.linkOf(userId);
  if (!link) return 'not_linked';
  const token = await botTokenFor(link.teamId);
  if (!token) return 'failed';
  const quote = m.quote ? oneLine(m.quote, 300) : '';
  const r = await callSlack('chat.postMessage', token, {
    channel: link.dmChannel,
    // The notification's own text (what a phone shows); the blocks are the message itself.
    text: mrkdwn(m.title),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${mrkdwn(m.title)}*${quote ? `\n>${mrkdwn(quote)}` : ''}\n<${m.url}|${mrkdwn(m.linkLabel)}>` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Freero · <${appUrl(null, '/settings#notifications')}|Choose what Freero sends you here>` }] },
    ],
    unfurl_links: false,
    unfurl_media: false,
  });
  const outcome: SlackDmOutcome = r.ok ? 'sent' : 'failed';
  sent.inc({ outcome });
  if (!r.ok) logger.warn({ slack: { dm: 'failed', team: link.teamId, error: r.error ?? null } }, 'slack dm failed');
  return outcome;
}
