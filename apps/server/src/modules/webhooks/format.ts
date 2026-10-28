// What a webhook delivery says (pure): the event as JSON, or a ready-made chat message for a Slack
// or Microsoft Teams incoming webhook (Teams: a Workflows "post to a channel when a webhook request
// is received" URL, which takes an Adaptive Card). The wording is Freero's own; board text (titles,
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

/** The body of one delivery in the endpoint's format. */
export function renderBody(format: WebhookFormat, e: FreeroEvent, words: EventWords): string {
  if (format === 'json') return JSON.stringify(e);
  const title = e.board.title || 'Untitled board';
  if (format === 'slack') {
    const sentence = slackEscape(words.sentence).replace('{board}', `<${e.board.url}|${slackEscape(title)}>`);
    const quote = words.quote ? `\n>${slackEscape(words.quote).replace(/\n/g, '\n>')}` : '';
    const text = `${sentence}${quote}`;
    return JSON.stringify({
      text: `${slackEscape(words.sentence.replace('{board}', `“${title}”`))}${words.quote ? `: ${slackEscape(words.quote)}` : ''}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
      unfurl_links: false,
    });
  }
  const sentence = teamsEscape(words.sentence).replace(teamsEscape('{board}'), `**${teamsEscape(title)}**`);
  return JSON.stringify({
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: sentence, wrap: true },
            ...(words.quote ? [{ type: 'TextBlock', text: teamsEscape(words.quote), wrap: true, isSubtle: true }] : []),
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open board', url: e.board.url }],
        },
      },
    ],
  });
}

/** A test delivery ("ping") in the endpoint's format. */
export function renderPing(format: WebhookFormat, workspaceId: string, at: number): string {
  const sentence = 'Freero webhook test: this endpoint is connected.';
  if (format === 'json') return JSON.stringify({ id: 'ping', type: 'ping', version: 1, createdAt: new Date(at).toISOString(), workspaceId });
  if (format === 'slack') return JSON.stringify({ text: sentence });
  return JSON.stringify({
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: sentence, wrap: true }] } }],
  });
}
