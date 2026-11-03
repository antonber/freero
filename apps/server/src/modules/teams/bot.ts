// Link previews in Microsoft Teams (#113; docs/integrations/teams.md): the Teams app's message
// extension registers the instance's host for links, so pasting a Freero link in a message sends the
// bot a `composeExtension/queryLink` invoke (or `composeExtension/anonymousQueryLink` for someone who
// hasn't added the app), answered in the HTTP response with an Adaptive Card
// (learn.microsoft.com/microsoftteams/platform/messaging-extensions/how-to/link-unfurling).
//
// What a preview may say is boards' `publicLinkPreview`, the rule Slack previews follow: title,
// description and thumbnail only for a board a visitor WITHOUT an account may open by its link (no
// password, guests allowed). Everything else — private boards, docs, boards that don't exist — is
// the same generic card, so a preview never tells whether a board exists or what it is called.
// Board text is untrusted: it only ever goes into TextRuns (plain text; Adaptive Cards' TextBlock
// would read Markdown, so a title could make a link).
import { logger } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import { checkRateLimit } from '../../platform/rateLimit';
import { publicLinkPreview } from '../boards/index';
import { isUploadRemoved } from '../uploads/index';

const outcomes = counter('freero_teams_link_previews_total', 'Teams link preview invokes by outcome', ['outcome'] as const);

export type PreviewOutcome = 'public' | 'generic' | 'not_ours' | 'rate_limited';

/** The invoke names a link preview arrives as. */
export const QUERY_LINK_INVOKES = ['composeExtension/queryLink', 'composeExtension/anonymousQueryLink'] as const;

/** The subset of a Bot Framework activity the bot reads. */
export interface TeamsActivity {
  type?: string;
  name?: string;
  channelId?: string;
  serviceUrl?: string;
  value?: { url?: unknown };
  conversation?: { tenantId?: string };
  channelData?: { tenant?: { id?: string } };
}

/** The board or doc a link of this instance opens (its app, embed and Teams pages), or null for any other link. */
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
  const m = /^\/(board|doc|embed\/b|teams\/b)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(u.pathname);
  if (!m) return null;
  return { kind: m[1] === 'doc' ? 'doc' : 'board', id: m[2] };
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Plain text in a card: a TextRun never reads Markdown. */
const plainText = (text: string, run: Record<string, unknown> = {}, block: Record<string, unknown> = {}) => ({
  type: 'RichTextBlock',
  ...block,
  inlines: [{ type: 'TextRun', text, ...run }],
});

function card(body: unknown[], openUrl: string) {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    // Teams previews links with Adaptive Cards up to 1.3.
    version: '1.3',
    body,
    actions: [{ type: 'Action.OpenUrl', title: 'Open in Freero', url: openUrl }],
  };
}

const result = (cards: unknown[]) => ({
  composeExtension: {
    type: 'result',
    attachmentLayout: 'list',
    attachments: cards.map((content) => ({
      contentType: 'application/vnd.microsoft.card.adaptive',
      content,
      // The compose box shows the preview; the message gets `content`.
      preview: { contentType: 'application/vnd.microsoft.card.adaptive', content },
    })),
  },
});

/** The card for one pasted link, or null when it isn't a link to this instance's boards or docs. */
export async function previewCard(url: string): Promise<{ card: unknown; outcome: 'public' | 'generic' } | null> {
  const target = linkTarget(url);
  if (!target) return null;
  const preview = target.kind === 'board' ? await publicLinkPreview(target.id) : null;
  if (!preview)
    return {
      outcome: 'generic',
      card: card([plainText('Freero board', { weight: 'Bolder', size: 'Medium' }), plainText('Sign in to Freero to view it.', { isSubtle: true })], url),
    };
  const title = oneLine(preview.title || 'Untitled board', 150);
  const description = oneLine(preview.description, 300) || 'A board on Freero';
  // Teams fetches the picture itself: an https address only, never one an operator removed.
  const image = preview.thumbnail && !(await isUploadRemoved(preview.thumbnail.replace(/^\/uploads\//, ''))) ? appUrl(null, preview.thumbnail) : null;
  return {
    outcome: 'public',
    card: card(
      [
        plainText(title, { weight: 'Bolder', size: 'Medium' }),
        plainText(description),
        ...(image?.startsWith('https://') ? [{ type: 'Image', url: image, altText: 'Board preview', size: 'Stretch' }] : []),
        plainText('Freero board · anyone with the link can view', { isSubtle: true, size: 'Small' }),
      ],
      url,
    ),
  };
}

/** Answers one link preview invoke: the body of the invoke response (HTTP 200). Logged with its outcome. */
export async function answerQueryLink(activity: TeamsActivity): Promise<unknown> {
  const tenant = String(activity.conversation?.tenantId ?? activity.channelData?.tenant?.id ?? 'unknown');
  const done = (outcome: PreviewOutcome, body: unknown) => {
    outcomes.inc({ outcome });
    logger.info({ teams: { invoke: activity.name, tenant, outcome } }, 'teams link preview');
    return body;
  };
  const url = typeof activity.value?.url === 'string' ? activity.value.url : '';
  if (!linkTarget(url)) return done('not_ours', result([]));
  const limit = await checkRateLimit('teamsUnfurl', tenant);
  if (!limit.allowed) return done('rate_limited', result([]));
  const p = await previewCard(url);
  if (!p) return done('not_ours', result([]));
  return done(p.outcome, result([p.card]));
}
