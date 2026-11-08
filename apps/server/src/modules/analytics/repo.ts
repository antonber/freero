// The only writer of `analytics_opt_outs` (accounts that turned analytics off).
import { query } from '../../platform/db';

// Product events wait for the change they report to commit (a rolled-back sign-up sends nothing).
export { afterCommit } from '../../platform/db';

export async function setOptedOut(userId: string, optedOut: boolean, now = Date.now()): Promise<void> {
  if (optedOut) await query(`INSERT INTO analytics_opt_outs (user_id, opted_out_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, new Date(now)]);
  else await query(`DELETE FROM analytics_opt_outs WHERE user_id = $1`, [userId]);
}

/** Whether any of these accounts turned analytics off. */
export async function anyOptedOut(userIds: string[]): Promise<boolean> {
  return (await query(`SELECT 1 FROM analytics_opt_outs WHERE user_id = ANY($1::text[]) LIMIT 1`, [userIds])).length > 0;
}
