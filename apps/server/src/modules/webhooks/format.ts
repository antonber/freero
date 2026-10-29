// What a webhook delivery says (pure): the event as JSON, or a ready-made chat message for a Slack,
// Microsoft Teams, Discord, Google Chat or Mattermost incoming webhook (Teams: a Workflows "post to
// a channel when a webhook request is received" URL, which takes an Adaptive Card). The wording is Freero's own; board text (titles,
// item text, comments) is quoted, escaped for the target's markup, never interpreted.
import type { BoardEventData, CommentEventData, FreeroEvent, ItemEventData, MemberEventData, WebhookFormat } from '@freero/shared';

const ITEM_NAMES: Record<string, string> = {
  sticky: 'a sticky note',
  text: 'a text box',
  shape: 'a shape',
  card: 'a card',
  frame: 'a frame',
  connector: 'a connector',
  image: 'an image',
  table: 'a table',
  mindmap: 'a mind-map node',
  kanban: 'a kanban board',
  pen: 'a drawing',
  emoji: 'a stamp',
  embed: 'an embed',
  pdf: 'a PDF',
  objectlink: 'a link',
  activity: 'a live activity',
  icon: 'an icon',
  swimlane: 'a swimlane',
  media: 'a video or audio clip',
  file: 'a file',
};
const itemName = (type: string) => ITEM_NAMES[type] ?? 'an item';
const ROLE_NAMES: Record<string, string> = { viewer: 'can view', commenter: 'can comment', editor: 'can edit' };

/** Plain parts of the message: who, what, the quoted board text (if any). */
export interface EventWords {
  /** One sentence in Freero's words; `{board}` marks where the board's title goes. */
  sentence: string;
  /** Board text to quote under it (an item's text, a comment), or null. */
  quote: string | null;
}

/**
 * `who`: the actor's name as the event should show it ("Maria", "Claude for Maria", "Freero"),
 * `person`: the name of the person a membership event is about.
 */
export function describe(e: FreeroEvent, who: string, person: string): EventWords {
  const board = e.data as BoardEventData;
  switch (e.type) {
    case 'board.created':
      return { sentence: board.copyOf ? `${who} made {board} as a copy of another board` : `${who} created {board}`, quote: null };
    case 'board.renamed':
      return { sentence: `${who} renamed “${board.from ?? ''}” to {board}`, quote: null };
    case 'board.moved':
      return { sentence: board.to ? `${who} moved {board} to the project “${board.to}”` : `${who} moved {board} out of its project`, quote: null };
    case 'board.trashed':
      return { sentence: `${who} moved {board} to the trash`, quote: null };
    case 'board.restored':
      return { sentence: `${who} restored {board} from the trash`, quote: null };
    case 'member.added': {
      const m = e.data as MemberEventData;
      return { sentence: `${who} gave ${person} access to {board} (${ROLE_NAMES[m.role ?? ''] ?? m.role})`, quote: null };
    }
    case 'member.role_changed': {
      const m = e.data as MemberEventData;
      return { sentence: `${who} changed ${person}’s access to {board} to “${ROLE_NAMES[m.role ?? ''] ?? m.role}”`, quote: null };
    }
    case 'member.removed':
      return { sentence: `${who} removed ${person}’s access to {board}`, quote: null };
    case 'item.created': {
      const i = (e.data as ItemEventData).item;
      return { sentence: `${who} added ${itemName(i.type)} to {board}`, quote: i.text ?? null };
    }
    case 'item.updated': {
      const i = (e.data as ItemEventData).item;
      const name = itemName(i.type);
      return { sentence: `${name.charAt(0).toUpperCase()}${name.slice(1)} changed on {board}`, quote: i.text ?? null };
    }
    case 'item.deleted': {
      const i = (e.data as ItemEventData).item;
      const name = itemName(i.type);
      return { sentence: `${name.charAt(0).toUpperCase()}${name.slice(1)} was deleted from {board}`, quote: null };
    }
    case 'comment.created':
      return { sentence: `${who} commented on {board}`, quote: (e.data as CommentEventData).text };
  }
}

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Teams TextBlocks read a little Markdown: keep board text literal. */
const teamsEscape = (s: string) => s.replace(/([\\`*_[\]()#>~|-])/g, '\\$1');

/**
 * Discord Markdown (embed descriptions): every character that formats, quotes, masks a link or
 * opens a mention (`<@…>`, `<#…>`) is backslash-escaped, which Discord shows as the character itself.
 * Mentions are switched off in the payload too (`allowed_mentions.parse: []`).
 */
const discordEscape = (s: string) => s.replace(/([\\`*_~|>#[\]()<-])/g, '\\$1');
/**
 * Mattermost reads `text` as Markdown (CommonMark: ASCII punctuation is backslash-escaped), turns
 * Slack-style `<url|text>` / `<!channel>` into links and pings, and pings `@channel`, `@all`, `@here`
 * and `@username` written as plain text. So punctuation is escaped, `&`, `<` and `>` become entities
 * (no `<` is left to read as Slack markup) and `@` its full-width twin: board text can neither
 * format, link nor ping anyone.
 */
const mattermostEscape = (s: string) =>
  s
    .replace(/([\\`*_~[\]()#+\-.!|{}])/g, '\\$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '＠');
/**
 * Google Chat's webhook text has no escape for its markup (`*bold*`, `<url|text>` links,
 * `<users/all>` mentions; developers.google.com/workspace/chat/format-messages). Angle brackets in
 * board text become look-alike angle quotes, so it can neither link nor mention anyone; emphasis
 * characters are left as they are (they can only change how the text looks).
 */
const googleChatEscape = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');
const clipTo = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Freero's primary colour (ui/tokens.css --fr-primary) as Discord's embed colour integer. */
const DISCORD_COLOR = 0x5b3ff0;
const PING_SENTENCE = 'Freero webhook test: this endpoint is connected.';

function adaptiveCard(body: unknown[], actions: unknown[] = []) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body, ...(actions.length ? { actions } : {}) },
      },
    ],
  };
}

/** The body of one delivery in the endpoint's format. */
export function renderBody(format: WebhookFormat, e: FreeroEvent, words: EventWords): string {
  if (format === 'json') return JSON.stringify(e);
  const title = e.board.title || 'Untitled board';
  switch (format) {
    case 'slack': {
      const sentence = slackEscape(words.sentence).replace('{board}', () => `<${e.board.url}|${slackEscape(title)}>`);
      const quote = words.quote ? `\n>${slackEscape(words.quote).replace(/\n/g, '\n>')}` : '';
      const text = `${sentence}${quote}`;
      return JSON.stringify({
        text: `${slackEscape(words.sentence.replace('{board}', () => `“${title}”`))}${words.quote ? `: ${slackEscape(words.quote)}` : ''}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
        unfurl_links: false,
      });
    }
    case 'teams': {
      const sentence = teamsEscape(words.sentence).replace(teamsEscape('{board}'), () => `**${teamsEscape(title)}**`);
      return JSON.stringify(
        adaptiveCard(
          [{ type: 'TextBlock', text: sentence, wrap: true }, ...(words.quote ? [{ type: 'TextBlock', text: teamsEscape(words.quote), wrap: true, isSubtle: true }] : [])],
          [{ type: 'Action.OpenUrl', title: 'Open board', url: e.board.url }],
        ),
      );
    }
    case 'discord': {
      // Execute Webhook with one embed (docs.discord.com/developers/resources/webhook; limits:
      // …/resources/message): the board's title links to the item, the sentence and the quoted
      // text below it.
      const sentence = discordEscape(words.sentence).replace('{board}', () => `**${discordEscape(title)}**`);
      const quote = words.quote ? `\n> ${discordEscape(words.quote).replace(/\n/g, '\n> ')}` : '';
      return JSON.stringify({
        embeds: [
          {
            title: clipTo(title, 256),
            url: e.board.url,
            description: clipTo(`${sentence}${quote}`, 4096),
            color: DISCORD_COLOR,
            timestamp: e.createdAt,
            footer: { text: 'Freero' },
          },
        ],
        allowed_mentions: { parse: [] },
      });
    }
    case 'google-chat': {
      // A text message (developers.google.com/workspace/chat/quickstart/webhooks); the board's title
      // is its link (`<url|text>`: no `|` or `>` in the text).
      const linkText = googleChatEscape(title).replace(/\|/g, '¦');
      const sentence = googleChatEscape(words.sentence).replace('{board}', () => `<${e.board.url}|${linkText}>`);
      const quote = words.quote ? `\n“${googleChatEscape(words.quote)}”` : '';
      return JSON.stringify({ text: `${sentence}${quote}` });
    }
    case 'mattermost': {
      // Mattermost's own incoming-webhook format (docs.mattermost.com, "Incoming webhooks"), not
      // Slack's: Mattermost ignores Slack's blocks and pings on a plain @channel (mattermostEscape).
      const sentence = mattermostEscape(words.sentence).replace(mattermostEscape('{board}'), () => `[${mattermostEscape(title)}](${e.board.url})`);
      const quote = words.quote ? `\n> ${mattermostEscape(words.quote).replace(/\n/g, '\n> ')}` : '';
      return JSON.stringify({ text: `${sentence}${quote}` });
    }
  }
}

/** A test delivery ("ping") in the endpoint's format. */
export function renderPing(format: WebhookFormat, workspaceId: string, at: number): string {
  switch (format) {
    case 'json':
      return JSON.stringify({ id: 'ping', type: 'ping', version: 1, createdAt: new Date(at).toISOString(), workspaceId });
    case 'slack':
    case 'google-chat':
    case 'mattermost':
      return JSON.stringify({ text: PING_SENTENCE });
    case 'teams':
      return JSON.stringify(adaptiveCard([{ type: 'TextBlock', text: PING_SENTENCE, wrap: true }]));
    case 'discord':
      return JSON.stringify({ content: PING_SENTENCE, allowed_mentions: { parse: [] } });
  }
}
