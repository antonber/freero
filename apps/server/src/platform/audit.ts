// Security-relevant actions taken on an account (by its owner, by someone holding its address, or
// by an operator), for an audit trail. Today every event is one structured log line
// (`"audit": {…}` in the server log). This is the seam for the Enterprise audit log: its module
// registers a sink with onAuditEvent (from its init.ts, and from its admin.ts for operator
// commands) and stores events in its own table. Never put passwords, tokens or codes in `detail`.
import { logError, logger } from './log';

export interface AuditEvent {
  /** 'auth.two_factor.reset_by_operator', 'auth.two_factor.recovery_started', … */
  action: string;
  /** Who did it: the account's user, an operator (the name they gave), or the server on its own. */
  actor: { kind: 'user'; userId: string } | { kind: 'operator'; name: string } | { kind: 'link'; purpose: string } | { kind: 'system' };
  /** The account it was done to. */
  userId: string;
  /** Free-form context (an operator's stated reason, how a recovery was cancelled). */
  detail?: Record<string, string | number | boolean | null>;
}

type AuditSink = (event: AuditEvent & { at: number }) => void | Promise<void>;
const sinks = new Set<AuditSink>();

/** Registers where audit events go besides the log; returns the unregister function. */
export function onAuditEvent(sink: AuditSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/** Records an audit event: logged always, then handed to every registered sink. Never throws. */
export async function audit(event: AuditEvent): Promise<void> {
  const e = { ...event, at: Date.now() };
  logger.info({ audit: e }, `audit: ${event.action}`);
  for (const sink of sinks) {
    try {
      await sink(e);
    } catch (err) {
      logError(`audit: a sink failed for ${event.action}`, err);
    }
  }
}
