// The only writer of `engage_answers`, `engage_questions`, `engage_upvotes` and `engage_reveals` [S4].
import type { ActivityAnswer } from '@freero/shared';
import { isForeignKeyViolation, one, query } from '../../platform/db';
import type { StoredAnswer, StoredQuestion } from './rules';

const parse = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);

/** Sets the person's answer (replacing an earlier one). False if the board is gone. */
export async function setAnswer(boardId: string, activityId: string, respondentId: string, name: string | null, value: ActivityAnswer, now: number): Promise<boolean> {
  try {
    await query(
      `INSERT INTO engage_answers (board_id, activity_id, respondent_id, respondent_name, value, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (board_id, activity_id, respondent_id) DO UPDATE SET respondent_name = excluded.respondent_name, value = excluded.value, updated_at = excluded.updated_at`,
      [boardId, activityId, respondentId, name, JSON.stringify(value), new Date(now)],
    );
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function deleteAnswer(boardId: string, activityId: string, respondentId: string): Promise<void> {
  await query(`DELETE FROM engage_answers WHERE board_id = $1 AND activity_id = $2 AND respondent_id = $3`, [boardId, activityId, respondentId]);
}

export async function myAnswer(boardId: string, activityId: string, respondentId: string): Promise<ActivityAnswer | null> {
  const r = await one<{ value: ActivityAnswer | string }>(
    `SELECT value FROM engage_answers WHERE board_id = $1 AND activity_id = $2 AND respondent_id = $3`,
    [boardId, activityId, respondentId],
  );
  return r ? parse(r.value) : null;
}

export async function answersOf(boardId: string, activityId: string, limit: number): Promise<StoredAnswer[]> {
  const rows = await query<{ value: ActivityAnswer | string; respondent_name: string | null }>(
    `SELECT value, respondent_name FROM engage_answers WHERE board_id = $1 AND activity_id = $2 ORDER BY updated_at LIMIT $3`,
    [boardId, activityId, limit],
  );
  return rows.map((r) => ({ value: parse(r.value), name: r.respondent_name }));
}

export async function countAnswers(boardId: string, activityId: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM engage_answers WHERE board_id = $1 AND activity_id = $2`, [boardId, activityId]))?.n ?? 0;
}

/** Starts over: every answer, question and upvote of the activity, and its reveal. */
export async function clearActivity(boardId: string, activityId: string): Promise<void> {
  await query(`DELETE FROM engage_answers WHERE board_id = $1 AND activity_id = $2`, [boardId, activityId]);
  await query(`DELETE FROM engage_questions WHERE board_id = $1 AND activity_id = $2`, [boardId, activityId]);
  await query(`DELETE FROM engage_reveals WHERE board_id = $1 AND activity_id = $2`, [boardId, activityId]);
}

// ---- Q&A ----

export async function addQuestion(q: { id: string; boardId: string; activityId: string; authorId: string; authorName: string | null; text: string; now: number }): Promise<boolean> {
  try {
    await query(
      `INSERT INTO engage_questions (id, board_id, activity_id, author_id, author_name, text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [q.id, q.boardId, q.activityId, q.authorId, q.authorName, q.text, new Date(q.now)],
    );
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function countQuestionsBy(boardId: string, activityId: string, authorId: string): Promise<number> {
  return (
    (await one<{ n: number }>(`SELECT count(*)::int AS n FROM engage_questions WHERE board_id = $1 AND activity_id = $2 AND author_id = $3`, [boardId, activityId, authorId]))
      ?.n ?? 0
  );
}

export async function questionsOf(boardId: string, activityId: string): Promise<StoredQuestion[]> {
  const rows = await query<{
    id: string;
    text: string;
    author_id: string | null;
    author_name: string | null;
    created_at: Date;
    answered_at: Date | null;
    hidden_at: Date | null;
    voters: string[] | null;
  }>(
    `SELECT q.id, q.text, q.author_id, q.author_name, q.created_at, q.answered_at, q.hidden_at,
            array_remove(array_agg(u.voter_id), NULL) AS voters
     FROM engage_questions q LEFT JOIN engage_upvotes u ON u.question_id = q.id
     WHERE q.board_id = $1 AND q.activity_id = $2
     GROUP BY q.id ORDER BY q.created_at`,
    [boardId, activityId],
  );
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    authorId: r.author_id,
    authorName: r.author_name,
    createdAt: r.created_at.getTime(),
    answered: r.answered_at !== null,
    hidden: r.hidden_at !== null,
    voters: r.voters ?? [],
  }));
}

/** The question if it belongs to this activity (and isn't hidden, unless `hiddenToo`). */
export async function questionIn(boardId: string, activityId: string, questionId: string, hiddenToo = false): Promise<boolean> {
  return (
    (await one(
      `SELECT 1 FROM engage_questions WHERE id = $1 AND board_id = $2 AND activity_id = $3 AND ($4 OR hidden_at IS NULL)`,
      [questionId, boardId, activityId, hiddenToo],
    )) !== null
  );
}

export async function setUpvote(questionId: string, voterId: string, on: boolean, now: number): Promise<void> {
  if (on) await query(`INSERT INTO engage_upvotes (question_id, voter_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [questionId, voterId, new Date(now)]);
  else await query(`DELETE FROM engage_upvotes WHERE question_id = $1 AND voter_id = $2`, [questionId, voterId]);
}

export async function mine(boardId: string, activityId: string, personId: string): Promise<{ upvotes: string[]; questions: string[] }> {
  const [up, asked] = await Promise.all([
    query<{ question_id: string }>(
      `SELECT u.question_id FROM engage_upvotes u JOIN engage_questions q ON q.id = u.question_id WHERE q.board_id = $1 AND q.activity_id = $2 AND u.voter_id = $3`,
      [boardId, activityId, personId],
    ),
    query<{ id: string }>(`SELECT id FROM engage_questions WHERE board_id = $1 AND activity_id = $2 AND author_id = $3`, [boardId, activityId, personId]),
  ]);
  return { upvotes: up.map((r) => r.question_id), questions: asked.map((r) => r.id) };
}

export async function moderateQuestion(questionId: string, patch: { answered?: boolean; hidden?: boolean }, now: number): Promise<void> {
  await query(
    `UPDATE engage_questions SET
       answered_at = CASE WHEN $2::boolean IS NULL THEN answered_at WHEN $2 THEN COALESCE(answered_at, $4) ELSE NULL END,
       hidden_at = CASE WHEN $3::boolean IS NULL THEN hidden_at WHEN $3 THEN COALESCE(hidden_at, $4) ELSE NULL END
     WHERE id = $1`,
    [questionId, patch.answered ?? null, patch.hidden ?? null, new Date(now)],
  );
}

// ---- reveals ----

export async function isRevealed(boardId: string, activityId: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM engage_reveals WHERE board_id = $1 AND activity_id = $2`, [boardId, activityId])) !== null;
}

export async function setRevealed(boardId: string, activityId: string, revealed: boolean, now: number): Promise<void> {
  if (revealed)
    await query(`INSERT INTO engage_reveals (board_id, activity_id, revealed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [boardId, activityId, new Date(now)]);
  else await query(`DELETE FROM engage_reveals WHERE board_id = $1 AND activity_id = $2`, [boardId, activityId]);
}

// ---- people (data exports, account purge) ----

export async function answersBy(personId: string): Promise<Array<{ boardId: string; activityId: string; value: ActivityAnswer; givenOpenly: boolean; updatedAt: number }>> {
  const rows = await query<{ board_id: string; activity_id: string; value: ActivityAnswer | string; respondent_name: string | null; updated_at: Date }>(
    `SELECT board_id, activity_id, value, respondent_name, updated_at FROM engage_answers WHERE respondent_id = $1 ORDER BY updated_at`,
    [personId],
  );
  return rows.map((r) => ({ boardId: r.board_id, activityId: r.activity_id, value: parse(r.value), givenOpenly: r.respondent_name !== null, updatedAt: r.updated_at.getTime() }));
}

export async function questionsBy(personId: string): Promise<Array<{ boardId: string; activityId: string; text: string; createdAt: number }>> {
  const rows = await query<{ board_id: string; activity_id: string; text: string; created_at: Date }>(
    `SELECT board_id, activity_id, text, created_at FROM engage_questions WHERE author_id = $1 ORDER BY created_at`,
    [personId],
  );
  return rows.map((r) => ({ boardId: r.board_id, activityId: r.activity_id, text: r.text, createdAt: r.created_at.getTime() }));
}

/** A deleted account: its answers and upvotes go; its questions stay on the boards, without a name. */
export async function forget(personId: string): Promise<void> {
  await query(`DELETE FROM engage_answers WHERE respondent_id = $1`, [personId]);
  await query(`DELETE FROM engage_upvotes WHERE voter_id = $1`, [personId]);
  await query(`UPDATE engage_questions SET author_id = NULL, author_name = NULL WHERE author_id = $1`, [personId]);
}
