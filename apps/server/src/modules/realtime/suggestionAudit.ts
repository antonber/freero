// The audit log's record of decisions on suggestions (KAI-169): one event per decision step
// (an "Accept all" of ten items is one event), in the board's workspace log, wherever it was
// made — a socket on this instance (rooms.ts, after the guard let it through) or a request
// (the public API). Never board text: ids, counts and who proposed them.
import type { AuditAction, SuggestionDecision, SuggestionRecord } from '@freero/shared';
import { logError } from '../../platform/log';
import { recordAuditQuietly } from '../audit/index';
import { boardWorkspaceId, getBoardTitle } from '../boards/index';

export interface DecisionStep {
  record: SuggestionRecord;
  /** The decision before and after (undefined: pending). */
  from: SuggestionDecision | undefined;
  to: SuggestionDecision | undefined;
}

const ACTION: Record<'accepted' | 'rejected' | 'reopened', AuditAction> = {
  accepted: 'board.suggestion_accepted',
  rejected: 'board.suggestion_rejected',
  reopened: 'board.suggestion_reopened',
};

/** Records the decisions `actorId` made on `boardId` (`via`: the app's board socket or the API). */
export async function auditDecisions(boardId: string, actorId: string, steps: readonly DecisionStep[], via: 'board' | 'api'): Promise<void> {
  if (!steps.length) return;
  try {
    const kinds = new Map<'accepted' | 'rejected' | 'reopened', DecisionStep[]>();
    for (const s of steps) {
      const kind = s.to ? s.to.status : 'reopened';
      kinds.set(kind, [...(kinds.get(kind) ?? []), s]);
    }
    const [workspaceId, title] = await Promise.all([boardWorkspaceId(boardId), getBoardTitle(boardId)]);
    for (const [kind, list] of kinds) {
      const authors = [...new Set(list.map((s) => `${s.record.author.kind}:${s.record.author.credentialId ?? s.record.author.userId}`))];
      await recordAuditQuietly({
        action: ACTION[kind],
        ...(workspaceId ? { workspaceId } : { accountId: actorId, fanOut: false }),
        actorId,
        target: { type: 'board', id: boardId, label: title },
        metadata: {
          via,
          suggestions: list.length,
          groups: [...new Set(list.map((s) => s.record.groupId))],
          proposedBy: authors,
          ...(list.some((s) => s.to?.forced) ? { forced: true } : {}),
        },
      });
    }
  } catch (err) {
    logError(`realtime: could not audit suggestion decisions on board ${boardId}`, err);
  }
}
