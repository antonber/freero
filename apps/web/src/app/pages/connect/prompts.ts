// Starter prompts on the Connect page: one request per use case, to paste into a connected agent.
// `board` is the board the person came from (the board menu's link), else a placeholder to fill in.
import { t } from './messages';

export interface StarterPrompt {
  id: string;
  title: string;
  text: string;
  /** What the connection needs beyond the default read + suggest, said on the card. */
  needs: string | null;
}

export function starterPrompts(board: string | null): StarterPrompt[] {
  const on = board ? `my Freero board ${board}` : 'my Freero board <paste the board’s link>';
  return [
    {
      id: 'cluster',
      title: t('clusterThisBoard'),
      text: t('readOnWithGetBoard', { on }),
      needs: null,
    },
    {
      id: 'retro',
      title: t('runARetro'),
      text: t('runARetrospectiveOnOn', { on }),
      needs: t('changeBoardsOrItProposes'),
    },
    {
      id: 'roadmap',
      title: t('roadmapFromMyGithubIssues'),
      text: 'Create a Freero board called “Roadmap” with a kanban of three columns, Now, Next and Later (add_cards with columns). Bring in the open issues of <owner/repo> with import_from_tracker (query `repo:<owner/repo> is:open`, placement into that kanban’s Later column): each becomes a card linked to its issue, kept in sync both ways. Then move each card to Now, Next or Later with update_items (into the kanban, with the column), open the board with open_board and tell me why you sorted them that way.',
      needs: t('changeBoardsAndGithubConnected'),
    },
    {
      id: 'control-room',
      title: t('aControlRoomForMy'),
      text: 'Work on <your goal> in a Freero control room. Call post_status without a boardId to create the board with your plan, a one-line status and your first tasks, then open_board so I can watch. Before every step call get_feedback and follow what I changed (a card back in To do: redo it; out of Blocked: go ahead; a comment: a request). After every step, post_status again. When you need me, post the task as blocked with your question.',
      needs: t('changeBoards'),
    },
  ];
}
