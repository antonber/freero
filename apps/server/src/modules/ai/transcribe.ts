// Captions for a walkthrough recording (KAI-133) through the board's AI provider — the same
// decision as every AI action (decideAi: the operator's or the workspace's provider, who may use
// it, budgets), and only that provider: a recording never goes to any other third party. Off
// unless the operator names a speech-to-text model (AI_TRANSCRIBE_MODEL) and the board's endpoint
// is OpenAI-compatible (the Anthropic Messages API takes no audio).
import { estimateTokens, MAX_CUE_TEXT, MAX_TRANSCRIPT_CUES, type WalkthroughCue } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { recordAudit } from '../audit/index';
import { requireBoardDownload } from '../boards/index';
import { decideAi, requireAiOffered } from './access';
import { ProviderError, transcribe } from './providers';
import * as repo from './repo';
import { checkBudget, monthOf } from './service';

/** The most a transcription request sends (the common provider limit). */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

/** Whether captions could be made on this board for this person now (null) or why not. */
export async function transcriptionUnavailable(boardId: string, userId: string): Promise<string | null> {
  const config = getConfig().ai;
  if (!config.instance && !config.workspaceKeys) return 'AI isn’t set up on this Freero server.';
  const d = await decideAi(boardId, userId);
  if (!d.ok) return d.reason;
  if (!config.transcribeModel) return 'This Freero server has no speech-to-text model set up for AI.';
  if (d.grant.endpoint.provider !== 'openai') return 'This board’s AI provider doesn’t turn speech into text.';
  return null;
}

/**
 * Transcribes a recording for `userId` on the board. Throws HttpError 403 `ai_unavailable` with a
 * reason when it can't be done, 502 when the provider fails.
 */
export async function transcribeRecording(
  boardId: string,
  userId: string,
  audio: { bytes: Buffer; contentType: string; fileName: string },
  durationMs: number,
): Promise<WalkthroughCue[]> {
  requireAiOffered();
  const why = await transcriptionUnavailable(boardId, userId);
  if (why) throw new HttpError(403, why, 'ai_unavailable');
  const d = await decideAi(boardId, userId);
  if (!d.ok) throw new HttpError(403, d.reason, 'ai_unavailable');
  const g = d.grant;
  // The recording leaves Freero for the provider, like board content an AI action reads.
  await requireBoardDownload(boardId, userId, 'ai');
  if (audio.bytes.length > MAX_TRANSCRIBE_BYTES) throw new HttpError(413, 'This recording is too long to transcribe (25 MB at most).');
  await consumeRateLimit('ai', userId);
  await consumeRateLimit('aiWorkspace', g.workspaceId);
  await checkBudget(g, userId);
  const config = getConfig().ai;
  const audit = (outcome: string, extra: Record<string, number> = {}) =>
    recordAudit({
      action: 'ai.request',
      actorId: userId,
      ...(g.kind === 'team' ? { workspaceId: g.workspaceId } : { accountId: userId, fanOut: false }),
      target: { type: 'board', id: g.boardId, label: g.boardTitle },
      metadata: { source: g.source, provider: g.endpoint.provider, model: config.transcribeModel!, task: 'transcribe', outcome, ...extra },
    });
  let result;
  try {
    result = await transcribe(g.endpoint, audio, config.transcribeModel!, { allowPrivate: config.workspacePrivateEndpoints, timeoutMs: config.timeoutMs });
  } catch (e) {
    await audit('provider_error');
    if (e instanceof ProviderError) throw new HttpError(502, e.message, 'ai_provider');
    throw e;
  }
  const outputTokens = estimateTokens(result.text || result.segments.map((s) => s.text).join(' '));
  await repo.addUsage({ workspaceId: g.workspaceId, userId, month: monthOf(), source: g.source, inputTokens: 0, outputTokens });
  await audit('ok', { outputTokens });
  const cues: WalkthroughCue[] = result.segments.length
    ? result.segments.map((s) => ({ start: Math.round(s.start * 1000), end: Math.round(s.end * 1000), text: s.text.slice(0, MAX_CUE_TEXT) }))
    : [{ start: 0, end: durationMs, text: result.text.trim().slice(0, MAX_CUE_TEXT) }];
  return cues.slice(0, MAX_TRANSCRIPT_CUES);
}
