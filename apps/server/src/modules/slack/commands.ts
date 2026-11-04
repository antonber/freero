// /freero, the app's slash command (#105; docs.slack.dev/interactivity/implementing-slash-commands).
// Slack posts the command (signed, checked in routes.ts) and shows our answer only to the person
// who typed it (ephemeral). It acts as the Freero account linked to that Slack user — nobody else:
// a Slack user who never connected gets a pointer to the settings page and nothing about boards.
//   /freero new <title>   a board in their personal workspace, answered with its link
//   /freero <words>       their boards whose title has the words (every workspace they're in)
import type { BoardSummary } from '@freero/shared';
import { HttpError } from '../../platform/http';
import { logError } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import { checkRateLimit } from '../../platform/rateLimit';
import { createBoardFor, listBoardsIn } from '../boards/index';
import { workspaceRolesOf } from '../workspaces/index';
import { mrkdwn, oneLine } from './api';
import { linkedUserOf, slackConnectOffered } from './links';

const commands = counter('freero_slack_commands_total', '/freero commands by outcome', ['outcome'] as const);

export interface CommandReply {
  response_type: 'ephemeral';
  text: string;
}

const MAX_RESULTS = 10;
const reply = (text: string): CommandReply => ({ response_type: 'ephemeral', text });
const boardLink = (b: Pick<BoardSummary, 'id' | 'title'>) => `<${appUrl(null, `/board/${encodeURIComponent(b.id)}`)}|${mrkdwn(oneLine(b.title || 'Untitled board', 150))}>`;

/** Slack sends the command's text with `&`, `<` and `>` escaped. */
const unescapeSlack = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const HELP = ['*/freero new* _title_ — create a board and get its link', '*/freero* _words_ — find your boards whose title has those words'].join('\n');

export async function answerSlashCommand(form: URLSearchParams): Promise<CommandReply> {
  const done = (outcome: string, r: CommandReply) => {
    commands.inc({ outcome });
    return r;
  };
  if (!slackConnectOffered()) return done('off', reply('Freero’s Slack commands aren’t turned on on this server.'));
  const userId = await linkedUserOf(form.get('team_id') ?? '', form.get('user_id') ?? undefined);
  if (!userId)
    return done(
      'not_linked',
      reply(`Connect your Slack account to Freero first, in <${appUrl(null, '/settings#slack')}|Account settings → Slack>. Then /freero creates and finds boards for you.`),
    );
  const text = unescapeSlack(form.get('text') ?? '').trim();
  if (!text || /^help$/i.test(text)) return done('help', reply(HELP));
  try {
    const create = /^new(?:\s+([\s\S]*))?$/i.exec(text);
    if (create) {
      if (!(await checkRateLimit('boardCreate', `user:${userId}`)).allowed) return done('rate_limited', reply('You’ve created a lot of boards just now. Try again in a little while.'));
      const board = await createBoardFor(userId, { title: create[1]?.trim() || undefined, description: '' });
      return done('created', reply(`Created ${boardLink(board)} in your personal workspace.`));
    }
    if (!(await checkRateLimit('search', `user:${userId}`)).allowed) return done('rate_limited', reply('That’s a lot of searches. Try again in a minute.'));
    const q = text.slice(0, 200);
    const found = new Map<string, BoardSummary>();
    for (const ws of (await workspaceRolesOf(userId)).keys()) for (const b of await listBoardsIn(userId, ws, q, undefined, 'board')) found.set(b.id, b);
    const boards = [...found.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!boards.length) return done('searched', reply(`No board of yours has “${mrkdwn(oneLine(q, 80))}” in its title. Create one with */freero new* _title_.`));
    const lines = boards.slice(0, MAX_RESULTS).map((b) => `• ${boardLink(b)}`);
    const more = boards.length > MAX_RESULTS ? `\n…and ${boards.length - MAX_RESULTS} more in <${appUrl(null, '/app')}|Freero>.` : '';
    return done('searched', reply(`Boards with “${mrkdwn(oneLine(q, 80))}”:\n${lines.join('\n')}${more}`));
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) return done('refused', reply(mrkdwn(e.message)));
    logError('slack command failed', e);
    return done('failed', reply('Something went wrong in Freero. Try again in a moment.'));
  }
}
