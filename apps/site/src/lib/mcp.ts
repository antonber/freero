// What Freero's MCP server offers, as the site tells people and agents about it (/agents, /llms.txt).
// Kept in step with apps/server/src/modules/mcp (tools.ts, prompts.ts): site.test.ts fails when a
// tool or prompt is added there and not here, or listed here and gone there.

/** [tool, permission it needs, what it does], in the order the site lists them. */
export const MCP_TOOLS: Array<[name: string, needs: 'read' | 'suggest' | 'write' | 'comment', summary: string]> = [
  ['list_workspaces', 'read', 'Your workspaces (personal and teams) and your role in each.'],
  ['search_boards', 'read', 'Boards you can open, newest change first, filtered by title or workspace.'],
  ['search', 'read', 'Words in what your boards say: notes, text, shapes, cards, frames, tables, tags, connector labels, comments. Each hit with board, item, snippet and link.'],
  ['get_board_outline', 'read', 'The board as a semantic outline (Markdown or JSON) with item ids, a token budget, a scope and paging.'],
  ['export_board', 'read', 'The whole board as a Markdown or JSON file; follows the workspace’s download policy.'],
  ['resolve_links', 'read', 'What Freero board and item links point at, and whether you can open them.'],
  ['find_backlinks', 'read', 'Items and comments that link to a board or an item.'],
  ['list_templates', 'read', 'Saved templates you can start a board from.'],
  ['open_board', 'read', 'The live board in the conversation, in hosts that show MCP Apps views; elsewhere its link. The view never has more power than the connection.'],
  ['search_docs', 'read', 'Docs (collaborative documents next to boards) you can open, by title.'],
  ['read_doc', 'read', 'A doc as Markdown, with embedded boards as their addresses.'],
  ['get_feedback', 'read', 'What people changed in the agent’s control-room lane since its last look: cards moved, added or removed, new comments.'],
  ['propose_changes', 'suggest', 'A structure (notes, clusters, a diagram) proposed as one group of suggestions for editors to accept or reject.'],
  ['create_board', 'write', 'A new board in a personal or team workspace, optionally from a template.'],
  ['add_stickies', 'write', 'A titled grid of sticky notes, each with its own link if you like, in free space or into a frame, kanban column or cluster.'],
  ['add_clusters', 'write', 'Titled groups side by side; existing notes can move into them.'],
  ['add_cards', 'write', 'Task cards with description, status, due date and link, into a kanban column, a frame or a cluster, or a new kanban with its columns.'],
  ['import_from_tracker', 'write', 'Issues from a Jira, Linear or GitHub query as cards linked to them, kept in sync both ways; proposed instead when the connection may only suggest.'],
  ['import_meeting_notes', 'write', 'Meeting notes or a transcript (Markdown, text, WebVTT, SRT) as one frame: decisions as a cluster, action items as cards with owner and due date, points as notes, who spoke. Read as written, no AI.'],
  ['add_diagram', 'write', 'A Mermaid flowchart or sequence diagram, a mind map or tree from an outline, or a node-and-edge graph, laid out by Freero.'],
  ['update_items', 'write', 'Several items changed in one all-or-nothing step: text, fields, colours, frames, locks, links, and moves into a frame, kanban column or cluster.'],
  ['delete_items', 'write', 'Deletes items, only with an explicit confirmation.'],
  ['create_doc', 'write', 'A new doc from Markdown, personal or in a team workspace.'],
  ['append_to_doc', 'write', 'Markdown added to the end of a doc; everyone with it open sees it arrive.'],
  ['post_status', 'write', 'The agent’s plan, status and tasks (to do, doing, done, blocked) on its lane of a control-room board; retries never duplicate.'],
  ['list_tracker_connections', 'read', 'The issue trackers the person can use on a board, with each one’s default project, and a connection’s projects or repositories.'],
  ['sync_to_tracker', 'write', 'Sends items to the board’s Jira, Linear or GitHub as one issue or one per item, kept in sync.'],
  ['add_comment', 'comment', 'A comment on the board or an item, or a reply in a thread.'],
];

/** [prompt, what it sets the agent up to do]. */
export const MCP_PROMPTS: Array<[name: string, summary: string]> = [
  ['control_room', 'Work on a goal in a control room: post the plan and tasks, check what people changed, repeat.'],
  ['run_retro', 'Group a retro board’s notes into themes, then add action cards and offer to send them to the tracker.'],
  ['notes_to_diagram', 'Turn notes into a diagram on a board.'],
  ['summarize_board', 'Topics, decisions, open questions and action items, with item ids.'],
];
