// Where a planned structure goes. The plan (plan.ts) doesn't know; a sink decides:
//   board    written to the live board now, as one change (realtime.changeBoard: planned against
//            the live doc and applied in the same step, attributed, published, saved).
//   preview  planned against the board as it is, not written (the app inserts it itself with
//            Editor.insertElements: one undo step for its user).
// The suggestions layer (KAI-169) adds a sink here that hands the same BoardChange to realtime's
// suggestions store instead of the shared doc; callers pick it with `target`.
import type { InsertStructureRequest } from '@freero/shared';
import { changeBoard, readBoardView, type AppliedChange, type BoardActor } from '../realtime/index';
import { planStructure, type Plan } from './plan';

export type StructureTarget = NonNullable<InsertStructureRequest['target']>;

export interface StructureSink {
  apply(boardId: string, actor: BoardActor, req: InsertStructureRequest, newId: () => string): Promise<Plan & { applied: AppliedChange | null }>;
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
};
