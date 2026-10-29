// Agents: a control room where a long-running AI agent works in the open (KAI-172). The lane's
// names follow the MCP server's `post_status` (server modules/api controlRoom.ts): "Plan · Agent",
// "Status · Agent" and the "Tasks · Agent" kanban; the first agent that posts claims the lane and
// renames it after itself.
import { Kit, kanbanSize, rt, titled, type KanbanColumnSpec } from '../kit';
import { CORAL, HEAD, INK_SOFT, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const agentControlRoom: TemplateDef = {
  id: 'agent-control-room',
  name: 'Agent control room',
  description: 'Watch and steer an AI agent: it posts its plan, status and tasks here; you move cards and comment to redirect it.',
  categories: ['engineering', 'ai', 'planning'],
  keywords: ['agent', 'ai agent', 'control room', 'mcp', 'automation', 'claude', 'chatgpt', 'copilot', 'status', 'blockers', 'oversight'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 260;
    const columns: KanbanColumnSpec[] = [
      { title: 'To do', status: 'todo', color: HEAD.gray, items: [{ card: 'Write the migration script', desc: 'Dry run on a copy first', color: VIOLET }] },
      { title: 'Doing', status: 'doing', color: HEAD.sky, items: [{ card: 'Inventory the old tables', desc: '14 of 22 checked', color: SKY }] },
      { title: 'Done', status: 'done', color: HEAD.mint, items: [{ card: 'Read the schema docs', color: MINT }] },
      { title: 'Blocked', color: HEAD.coral, items: [{ card: 'Get read access to production', desc: 'Who can approve this?', color: CORAL }] },
    ];
    const kb = kanbanSize(colW, columns);
    const noteW = 380;
    const top = 160;
    const bodyH = Math.max(kb.h + 40, 620);
    const W = 48 + noteW + 32 + kb.w + 48;
    k.frame('Agent control room', W, top + bodyH + 48);
    k.header('Agent control room', 'An AI agent posts here as it works (Freero’s MCP tools post_status / get_feedback). Drag a card back to To do to have it redone, out of Blocked to unblock it, or comment on any card: the agent reads your changes before its next step.', W);
    const note = (y: number, h: number, html: string, fill: string, stroke: string) =>
      k.shape('roundRect', 48, y, noteW, h, html, { fill, stroke, fontSize: 16, align: 'left', vAlign: 'top' });
    note(top, 230, titled('Plan · Agent', '1. Read the schema docs\n2. Inventory the old tables\n3. Write and test the migration\n4. Hand over for review'), TINT.violet, VIOLET);
    note(top + 254, 150, titled('Status · Agent', 'Checking the old tables, 14 of 22 so far. Waiting on production access for the rest.'), TINT.sky, SKY);
    note(top + 428, 190, titled('How to steer', 'Move cards between columns · comment on a card to answer or redirect · add a card to give the agent a task · keep each agent in its own lane'), TINT.gray, INK_SOFT);
    k.kanban(48 + noteW + 32, top, 'Tasks · Agent', colW, columns);
    k.text(48 + noteW + 32, top + kb.h + 12, kb.w, rt('Cards in Blocked carry the agent’s question in their note.'), { size: 14, color: INK_SOFT, h: 22 });
    return k.done();
  },
};
