// A walkthrough's summary and chapters drafted from its captions (#127), through the board's AI
// provider — the same decision as every AI action (decideAi: who may, which provider), the
// downloads policy (the captions leave Freero for the provider), rate limits, budgets and the
// audit. The captions go to the model as untrusted data (they are someone's words). The draft is
// saved nowhere here: modules/walkthroughs hands it to the author to edit.
import type { WalkthroughChaptersInput, WalkthroughCue } from '@freero/shared';
import { HttpError } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { requireBoardDownload } from '../boards/index';
import { decideAi, requireAiOffered } from './access';
import { ProviderError } from './providers';
import { ask, auditAi, checkBudget } from './service';
import { chaptersTask, InvalidOutput } from './tasks';

/**
 * Drafts a summary and chapters for `userId` from these captions. Throws HttpError 404 when AI is
 * off on this server, 403 `ai_unavailable` with the reason, 429 `ai_budget`, 502 when the model
 * fails or answers twice with something unusable.
 */
export async function draftWalkthroughChapters(boardId: string, userId: string, cues: WalkthroughCue[], durationMs: number): Promise<WalkthroughChaptersInput> {
  requireAiOffered();
  const d = await decideAi(boardId, userId);
  if (!d.ok) throw new HttpError(403, d.reason, 'ai_unavailable');
  const g = d.grant;
  await requireBoardDownload(boardId, userId, 'ai');
  await consumeRateLimit('ai', userId);
  await consumeRateLimit('aiWorkspace', g.workspaceId);
  await checkBudget(g, userId);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const meta = { task: 'chapters', target: 'draft', items: cues.length };
  try {
    const asked = await ask(g, userId, chaptersTask(cues, durationMs), usage);
    await auditAi(g, userId, { ...meta, ...usage, outcome: 'ok' });
    return asked.walkthrough!;
  } catch (e) {
    await auditAi(g, userId, { ...meta, ...usage, outcome: e instanceof InvalidOutput ? 'invalid_output' : e instanceof ProviderError ? 'provider_error' : 'error' });
    if (e instanceof InvalidOutput) throw new HttpError(502, 'The AI’s answer couldn’t be used. Try again, or write the chapters yourself.', 'ai_invalid_output');
    if (e instanceof ProviderError) throw new HttpError(502, e.message, 'ai_provider');
    throw e;
  }
}
