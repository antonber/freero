// Where a planned structure goes. The plan (plan.ts) doesn't know; a sink decides:
//   board        written to the live board now, as one change (realtime.changeBoard: planned
//                against the live doc and applied in the same step, attributed, published, saved).
//   preview      planned against the board as it is, not written (the app inserts it itself with
//                Editor.insertElements: one undo step for its user).
//   suggestions  planned the same way, but proposed instead of written (realtime.proposeSuggestions,
//                KAI-169): one group of suggestions in the editors layer that people who can edit
//                accept or reject; the board itself does not change. Its existence is what turns on
//                MCP's propose_changes (structureTargets()).
import type { InsertStructureRequest, SuggestionAuthor } from '@freero/shared';
import { changeBoard, proposeSuggestions, readBoardView, type AppliedChange, type BoardActor } from '../realtime/index';
import { planStructure, type Plan } from './plan';

export type StructureTarget = NonNullable<InsertStructureRequest['target']>;

/**
 * For the suggestions sink (the others ignore it): what the proposal does, and who it is from
 * when not the actor themselves or the app acting for them (in-app AI: "AI for <Person>").
 */
export interface SinkContext {
  description: string;
  author?: SuggestionAuthor;
}

export interface StructureSink {
  apply(
    boardId: string,
    actor: BoardActor,
    req: InsertStructureRequest,
    newId: () => string,
    ctx: SinkContext,
  ): Promise<Plan & { applied: AppliedChange | null; groupId?: string }>;
}

export const SINKS: Record<StructureTarget, StructureSink> = {
  board: {
    apply: (boardId, actor, req, newId) => changeBoard(boardId, actor, (view) => planStructure(req, view, newId)),
  },
  preview: {
    async apply(boardId, actor, req, newId) {
      const view = await readBoardView(boardId, actor);
      return { ...planStructure(req, view, newId), applied: null };
    },
  },
  suggestions: {
    async apply(boardId, actor, req, newId, ctx) {
      const out = await proposeSuggestions(boardId, actor, ctx, (view) => {
        const plan = planStructure(req, view, newId);
        return { ...plan, content: plan.placed.content };
      });
      return { change: out.change, placed: out.placed, applied: null, groupId: out.records[0]?.groupId };
    },
  },
};
