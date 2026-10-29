// The chat formats (#88): each body has the shape its platform documents for an incoming webhook,
// and board text written to break out of it (pings, links, markup) arrives as plain text.
//   Discord:     docs.discord.com/developers/resources/webhook (Execute Webhook), …/resources/message (embed limits, allowed_mentions)
//   Google Chat: developers.google.com/workspace/chat/quickstart/webhooks, …/chat/format-messages
//   Mattermost:  docs.mattermost.com/developers/integrate/webhooks/incoming
import { expect, it } from 'vitest';
import type { FreeroEvent } from '@freero/shared';
import { describe as words, renderBody, renderPing } from './format';

const HOSTILE = 'Ship it <!channel> @everyone @all <users/all> <@123> [win](https://evil.example) *now*';
const event: FreeroEvent = {
  id: 'evt_1',
  type: 'comment.created',
  version: 1,
  createdAt: '2026-10-29T10:00:00.000Z',
  workspaceId: 'w1',
  board: { id: 'b1', title: 'Launch <plan> | Q4', url: 'https://freero.example/board/b1?thread=t1' },
  actor: { kind: 'user', id: 'u1', name: 'Maria' },
  data: { threadId: 't1', messageId: 'm1', itemId: null, text: HOSTILE },
};
const body = (format: 'discord' | 'google-chat' | 'mattermost') => JSON.parse(renderBody(format, event, words(event, 'Maria', 'someone')));

it('a Discord delivery is one embed within Discord’s limits that links the board and can ping nobody, and its test ping is a message Discord accepts', () => {
  const b = body('discord');
  expect(b.allowed_mentions).toEqual({ parse: [] });
  expect(b.embeds).toHaveLength(1);
  const [embed] = b.embeds;
  expect(embed.url).toBe(event.board.url);
  expect(embed.title.length).toBeLessThanOrEqual(256);
  expect(embed.description.length).toBeLessThanOrEqual(4096);
  expect(Number.isInteger(embed.color)).toBe(true);
  // Board text can't open a mention or mask a link: every such character is escaped.
  expect(embed.description).not.toMatch(/(^|[^\\])<[@#!]/);
  expect(embed.description).not.toMatch(/(^|[^\\])\[win\]/);
  expect(embed.description).toContain('Maria commented on **Launch \\<plan\\> \\| Q4**');
  // Discord refuses a message without content or embeds.
  expect(JSON.parse(renderPing('discord', 'w1', 0)).content).toBeTruthy();
});

it('a Google Chat delivery is a text message whose only link is the board and whose board text can’t mention the space', () => {
  const b = body('google-chat');
  expect(Object.keys(b)).toEqual(['text']);
  expect(b.text.match(/<[^>]*>/g)).toEqual([`<${event.board.url}|Launch ‹plan› ¦ Q4>`]);
  expect(b.text).not.toContain('<users/all>');
  expect(b.text).toContain('Ship it');
});

it('a Mattermost delivery is Markdown text that links the board, and board text can’t ping the channel, link or turn into Slack markup', () => {
  const b = body('mattermost');
  expect(Object.keys(b)).toEqual(['text']);
  const text: string = b.text;
  expect(text.startsWith('Maria commented on [Launch &lt;plan&gt; \\| Q4](https://freero.example/board/b1?thread=t1)')).toBe(true);
  // Mattermost pings on a plain @channel / @all / @here and on Slack's <!channel>.
  expect(text).not.toMatch(/@(channel|all|here|everyone)\b/);
  expect(text).not.toContain('<');
  // One link only: the board's (an escaped bracket never opens one).
  expect(text.match(/(^|[^\\])\]\(/g)).toHaveLength(1);
});
