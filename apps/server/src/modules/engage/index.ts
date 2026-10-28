// Public API of modules/engage [S2]: live audience activities (KAI-132). Answers, questions and
// upvotes live in this module's tables; the board only ever gets results (realtime's
// server-written collection). Answers of a deleted board go with it (ON DELETE CASCADE).
import * as repo from './repo';

/** For a person's data export: the answers they gave and the questions they asked. */
export async function engageExportOf(personId: string): Promise<{ answers: unknown[]; questions: unknown[] }> {
  const [answers, questions] = await Promise.all([repo.answersBy(personId), repo.questionsBy(personId)]);
  return {
    answers: answers.map((a) => ({ ...a, updatedAt: new Date(a.updatedAt).toISOString() })),
    questions: questions.map((q) => ({ ...q, createdAt: new Date(q.createdAt).toISOString() })),
  };
}

/**
 * The account purge: the person's answers and upvotes are deleted; questions they asked stay on
 * the boards without their name. Results on boards update with the activity's next change.
 */
export function forgetEngageRespondent(personId: string): Promise<void> {
  return repo.forget(personId);
}
