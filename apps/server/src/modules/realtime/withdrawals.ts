// Revoking a token or an app withdraws its pending suggestions (KAI-224). apiauth announces each
// revocation through the outbox, in the transaction that deletes the credential
// (`CREDENTIAL_REVOKED_TOPIC`: a token, an app's consent, an app deleted by its developer, or all of
// a person's); this consumer finds the boards through the `board_suggestion_authors` hint
// (proposeSuggestions notes each app's proposals there) and withdraws them on each live board
// (rooms.ts `withdrawSuggestionsOn`), so open boards drop them at once. Idempotent: a replayed event
// finds nothing pending any more. A board that fails is retried with the batch (the outbox).
import type { OutboxConsumer } from '../../platform/outbox';
import { log } from '../../platform/log';
import { CREDENTIAL_REVOKED_TOPIC, type CredentialRevoked } from '../apiauth/index';
import { boardsWithSuggestionsOf } from './repo';
import { withdrawSuggestionsOn } from './rooms';

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Withdraws everything pending from `who` on every board; returns how many suggestions. */
export async function withdrawRevokedSuggestions(who: CredentialRevoked): Promise<number> {
  if (who.userId === null && who.credentialId === null) return 0; // never "everyone's everything"
  let n = 0;
  for (const boardId of await boardsWithSuggestionsOf(who)) n += await withdrawSuggestionsOn(boardId, who);
  if (n) log(`realtime: withdrew ${n} suggestion(s) of a revoked credential`);
  return n;
}

export const SUGGESTION_WITHDRAWALS_CONSUMER = 'suggestion-withdrawals';

export const suggestionWithdrawalsConsumer: OutboxConsumer = {
  name: SUGGESTION_WITHDRAWALS_CONSUMER,
  topics: [CREDENTIAL_REVOKED_TOPIC],
  lockKey: 7_202_611_130, // arbitrary, constant across releases
  batchSize: 50,
  async handle(events) {
    for (const e of events) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      await withdrawRevokedSuggestions({ userId: str(p.userId), credentialId: str(p.credentialId) });
    }
  },
};
