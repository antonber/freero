// AI board actions (KAI-102) on the AI foundation (KAI-101): who may, through which provider,
// within which limits; read the board through the outline, ask the model, validate its answer,
// and hand the structure to modules/structure (preview or one attributed change). Every request
// that reaches the model is recorded in the audit log — task, model,
// tokens and outcome, never the prompt or board content.
import {
  AI_LIMITS,
  MAX_SUGGESTION_DESCRIPTION,
  renderOutlineMarkdown,
  estimateTokens,
  rotatedBounds,
  unionRects,
  type AiActionRequest,
  type AiActionResponse,
  type AiDiagramKind,
  type AuditValue,
  type BoardOutline,
  type OutlineItem,
  type Point,
  type StructureInput,
  type SuggestionAuthor,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { log } from '../../platform/log';
import { consumeRateLimit } from '../../platform/rateLimit';
import { recordAudit } from '../audit/index';
import { getUser } from '../auth/index';
import { requireBoardDownload } from '../boards/index';
import { boardOutline } from '../outline/index';
import { readBoardView } from '../realtime/index';
import { insertStructure } from '../structure/index';
import { decideAi, type AiGrant } from './access';
import { callModel, ProviderError } from './providers';
import * as repo from './repo';
import { clusterTask, diagramTask, ideasTask, InvalidOutput, parseReply, summarizeTask, TASKS, type ClusterItem, type TaskPlan } from './tasks';

/** What an AI action proposes, as its suggestions' description (reviewers read it). */
const TASK_DESCRIPTIONS: Record<AiActionRequest['task'], string> = {
  ideas: 'Ideas',
  cluster: 'Sorted into themes',
  summarize: 'Summary',
  diagram: 'Diagram',
};

/** Calendar month (UTC) usage is counted in. */
export const monthOf = (at = Date.now()) => new Date(at).toISOString().slice(0, 7);

/** Kinds clustering sorts into groups (notes; titles and other text boxes stay where they are). */
const CLUSTERABLE = new Set(['sticky', 'card']);
const DIAGRAMS: AiDiagramKind[] = ['flowchart', 'sequence', 'mindmap'];

function parseActionRequest(body: unknown): AiActionRequest {
  const b = (body ?? {}) as Partial<AiActionRequest>;
  if (typeof b !== 'object' || Array.isArray(b)) throw badRequest('Send { task, prompt?, ids? }');
  if (!TASKS.includes(b.task as never)) throw badRequest(`task must be one of ${TASKS.join(', ')}`);
  if (b.prompt !== undefined && (typeof b.prompt !== 'string' || b.prompt.length > AI_LIMITS.prompt))
    throw badRequest(`prompt must be text of at most ${AI_LIMITS.prompt} characters`);
  if (b.ids !== undefined && (!Array.isArray(b.ids) || b.ids.length > AI_LIMITS.ids || b.ids.some((id) => typeof id !== 'string' || !id || id.length > 200)))
    throw badRequest(`ids must be a list of at most ${AI_LIMITS.ids} element ids`);
  if (b.diagram !== undefined && !DIAGRAMS.includes(b.diagram)) throw badRequest(`diagram must be one of ${DIAGRAMS.join(', ')}`);
  if (b.target !== undefined && b.target !== 'board' && b.target !== 'preview' && b.target !== 'suggestions')
    throw badRequest('target must be board, preview or suggestions');
  if (b.near !== undefined && (typeof b.near !== 'string' || !b.near || b.near.length > 200)) throw badRequest('near must be an element id');
  if (b.at !== undefined && (typeof b.at !== 'object' || !b.at || !Number.isFinite(b.at.x) || !Number.isFinite(b.at.y))) throw badRequest('at must be { x, y }');
  const prompt = b.prompt?.trim() ?? '';
  if ((b.task === 'ideas' || b.task === 'diagram') && !prompt && !b.ids?.length) throw badRequest('Say what the ideas or the diagram should be about');
  if (b.task === 'cluster' && (b.ids?.length ?? 0) < 2) throw badRequest('Select at least two notes to cluster');
  return { task: b.task!, prompt, ids: b.ids ? [...new Set(b.ids)] : undefined, diagram: b.diagram, target: b.target ?? 'preview', near: b.near, at: b.at };
}

// ---- audit ----

async function auditAi(g: AiGrant, userId: string, metadata: Record<string, AuditValue>): Promise<void> {
  // A team board's request goes to the workspace's log. A personal board's to the person's own
  // log only: never fanned out to their teams (it names a personal board).
  await recordAudit({
    action: 'ai.request',
    actorId: userId,
    ...(g.kind === 'team' ? { workspaceId: g.workspaceId } : { accountId: userId, fanOut: false }),
    target: { type: 'board', id: g.boardId, label: g.boardTitle },
    metadata: { source: g.source, provider: g.endpoint.provider, model: g.endpoint.model, ...metadata },
  });
}

// ---- reading the board (through the outline: the reader's own view, budgeted) ----

/** Items of `o` (any depth) whose id is in `ids`, with what is under them, in reading order. */
function pick(items: OutlineItem[], ids: Set<string>, out: OutlineItem[] = []): OutlineItem[] {
  for (const it of items) {
    if (ids.has(it.id)) out.push(it);
    else if (it.children) pick(it.children, ids, out);
  }
  return out;
}

function idsIn(items: OutlineItem[], out = new Set<string>()): Set<string> {
  for (const it of items) {
    out.add(it.id);
    if (it.children) idsIn(it.children, out);
  }
  return out;
}

/** Cuts Markdown to about `budget` tokens at a line boundary. */
function fit(md: string, budget: number): string {
  if (estimateTokens(md) <= budget) return md;
  const out: string[] = [];
  let used = 0;
  for (const line of md.split('\n')) {
    const t = estimateTokens(line) + 1;
    if (used + t > budget) break;
    out.push(line);
    used += t;
  }
  out.push('(… the rest was cut to fit)');
  return out.join('\n');
}

const outlineQuery = { authors: false, comments: true } as const;

/** The board (or the selected items) as outline Markdown, within the token budget. */
async function readContent(boardId: string, userId: string, ids: string[] | undefined): Promise<string> {
  const budget = getConfig().ai.maxInputTokens;
  const url = `/board/${boardId}`;
  if (!ids?.length) {
    const r = await boardOutline(boardId, userId, url, { format: 'markdown', budget: Math.min(budget, 200_000), ...outlineQuery });
    return r === 'not-modified' ? '' : fit(r.markdown ?? '', budget);
  }
  const r = await boardOutline(boardId, userId, url, { format: 'json', limit: 5000, ...outlineQuery });
  if (r === 'not-modified') return '';
  const items = pick(r.outline.items, new Set(ids));
  const kept = idsIn(items);
  const sub: BoardOutline = {
    ...r.outline,
    items,
    edges: r.outline.edges.filter((e) => e.from && e.to && kept.has(e.from) && kept.has(e.to)),
    comments: [],
    notes: [],
    meta: { ...r.outline.meta, truncated: false, omitted: 0, returned: kept.size, nextCursor: undefined },
  };
  return fit(renderOutlineMarkdown(sub), budget);
}

/** The selected loose items with text, numbered for clustering (locked ones stay where they are). */
async function clusterItems(
  boardId: string,
  userId: string,
  role: AiGrant['role'],
  ids: string[],
): Promise<{ items: ClusterItem[]; center: Point | null; othersOwn: boolean }> {
  const [view, outline] = await Promise.all([
    readBoardView(boardId, { userId, role }),
    boardOutline(boardId, userId, `/board/${boardId}`, { format: 'json', limit: 5000, authors: false, comments: false }),
  ]);
  const wanted = new Set(ids);
  const els = view.elements.map((e) => e.el).filter((el) => wanted.has(el.id) && CLUSTERABLE.has(el.type) && !el.locked);
  const texts = new Map<string, string>();
  if (outline !== 'not-modified')
    for (const it of pick(outline.outline.items, new Set(els.map((e) => e.id)))) {
      const t = it.title && it.text ? `${it.title}: ${it.text}` : (it.title ?? it.text ?? '');
      if (t.trim()) texts.set(it.id, t.slice(0, 500));
    }
  const items = els.filter((el) => texts.has(el.id)).map((el) => ({ id: el.id, text: texts.get(el.id)! }));
  const b = unionRects(els.filter((el) => texts.has(el.id)).map((el) => rotatedBounds(el)));
  // Sorting moves the notes it sorts: someone else's notes are theirs to agree to move (KAI-169).
  const othersOwn = els.some((el) => texts.has(el.id) && el.createdBy !== userId);
  return { items, center: b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null, othersOwn };
}

/** The selected element furthest right: results about a selection land just right of it. */
async function rightmostOf(boardId: string, userId: string, role: AiGrant['role'], ids: string[]): Promise<string | undefined> {
  const wanted = new Set(ids);
  let best: { id: string; right: number } | undefined;
  for (const { el } of (await readBoardView(boardId, { userId, role })).elements) {
    if (!wanted.has(el.id)) continue;
    const b = rotatedBounds(el);
    if (!best || b.x + b.w > best.right) best = { id: el.id, right: b.x + b.w };
  }
  return best?.id;
}

// ---- asking the model ----

interface Asked {
  structure: StructureInput;
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Asks once; an answer that fails validation gets ONE repair turn naming what was wrong. Every
 * call is metered, also when it fails.
 */
async function ask(g: AiGrant, userId: string, plan: TaskPlan, usage: Asked['usage']): Promise<Asked> {
  const c = getConfig().ai;
  let calls = 0;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: plan.user }];
  try {
    for (let attempt = 0; ; attempt++) {
      calls++;
      let reply;
      try {
        reply = await callModel(
          g.endpoint,
          { system: plan.system, messages, maxTokens: c.maxOutputTokens, schema: plan.schema, timeoutMs: c.timeoutMs },
          { allowPrivate: c.workspacePrivateEndpoints },
        );
      } catch (e) {
        if (e instanceof ProviderError) {
          usage.inputTokens += e.usage.inputTokens;
          usage.outputTokens += e.usage.outputTokens;
        }
        throw e;
      }
      usage.inputTokens += reply.inputTokens;
      usage.outputTokens += reply.outputTokens;
      try {
        if (reply.truncated) throw new InvalidOutput('The answer was cut off at the length limit. Answer more briefly.');
        return { ...plan.accept(parseReply(reply.text)), usage };
      } catch (e) {
        if (!(e instanceof InvalidOutput) || attempt >= 1) throw e;
        messages.push(
          { role: 'assistant', content: reply.text.trim() || '(empty answer)' },
          { role: 'user', content: `That answer can't be used: ${e.message} Reply again with only the corrected JSON object.` },
        );
      }
    }
  } finally {
    if (calls) await repo.addUsage({ workspaceId: g.workspaceId, userId, month: monthOf(), source: g.source, ...usage });
  }
}

export async function checkBudget(g: AiGrant, userId: string): Promise<void> {
  const month = monthOf();
  if (g.monthlyTokenBudget !== null && (await repo.workspaceTokens(g.workspaceId, month)) >= g.monthlyTokenBudget)
    throw new HttpError(429, 'This workspace has used its AI budget for this month. Its admins can raise it in the admin console.', 'ai_budget');
  const cap = getConfig().ai.instanceMonthlyTokensPerUser;
  if (g.source === 'instance' && cap > 0 && (await repo.instanceTokensOf(userId, month)) >= cap)
    throw new HttpError(429, 'You’ve used this month’s AI allowance on this Freero server.', 'ai_budget');
}

/** Runs one AI action on a board (POST /boards/:id/ai/actions). */
export async function runAiAction(boardId: string, userId: string, body: unknown): Promise<AiActionResponse> {
  const req = parseActionRequest(body);
  const decision = await decideAi(boardId, userId);
  if (!decision.ok) throw new HttpError(403, decision.reason, 'ai_unavailable');
  const g = decision.grant;
  await consumeRateLimit('aiWorkspace', g.workspaceId);
  await checkBudget(g, userId);
  const prompt = req.prompt ?? '';
  const ids = req.ids?.length ? req.ids : undefined;

  // Reading board content takes it out of the board, to a model provider: the workspace's
  // "downloads" policy applies (KAI-197), as for exports and machine reads — the one shared check,
  // 403 downloads_restricted, audited as board.download_refused (via 'ai'). Ideas from a prompt
  // alone read nothing.
  if (req.task === 'cluster' || req.task === 'summarize' || ids) await requireBoardDownload(boardId, userId, 'ai');

  let plan: TaskPlan;
  let near = req.near;
  let at = req.at;
  // Where the result lands: what was asked, except that a result changing OTHER people's items
  // is never written (or previewed for writing) by one person's AI action: it is proposed, and
  // the people who can edit the board accept or reject it (suggestions, KAI-169).
  let target = req.target ?? 'preview';
  switch (req.task) {
    case 'ideas':
      plan = ideasTask(prompt, ids ? await readContent(boardId, userId, ids) : null);
      break;
    case 'cluster': {
      const { items, center, othersOwn } = await clusterItems(boardId, userId, g.role, ids!);
      if (items.length < 2) throw badRequest('Select at least two unlocked notes with text to cluster');
      if (othersOwn) target = 'suggestions';
      plan = clusterTask(prompt, items);
      // The groups form where the notes are (free space nearest to them).
      if (!near && center) at = center;
      break;
    }
    case 'summarize': {
      const content = await readContent(boardId, userId, ids);
      if (!content.trim()) throw badRequest('There is nothing to summarise here');
      plan = summarizeTask(prompt, content, ids ? 'selection' : 'board');
      if (ids && !near) near = await rightmostOf(boardId, userId, g.role, ids);
      break;
    }
    case 'diagram':
      plan = diagramTask(req.diagram ?? 'flowchart', prompt, ids ? await readContent(boardId, userId, ids) : null);
      if (ids && !near) near = await rightmostOf(boardId, userId, g.role, ids);
      break;
  }

  const meta = { task: req.task, target, items: ids?.length ?? 0 };
  // Tokens the calls used, also when they fail (the audit and the meter count them either way).
  const usage = { inputTokens: 0, outputTokens: 0 };
  let asked: Asked;
  try {
    asked = await ask(g, userId, plan, usage);
  } catch (e) {
    const outcome = e instanceof InvalidOutput ? 'invalid_output' : e instanceof ProviderError ? 'provider_error' : 'error';
    await auditAi(g, userId, { ...meta, ...usage, outcome });
    if (e instanceof InvalidOutput) throw new HttpError(502, 'The AI’s answer couldn’t be used, so nothing was changed. Try again or rephrase.', 'ai_invalid_output');
    if (e instanceof ProviderError) throw new HttpError(502, e.message, 'ai_provider');
    log('ai: request failed', { err: String(e) });
    throw e;
  }
  const tokens = { ...usage };
  let placed;
  try {
    // Proposed by the AI for this person: the badge reads "AI for <Person>".
    const description = `${TASK_DESCRIPTIONS[req.task]}${prompt ? `: ${prompt}` : ''}`.slice(0, MAX_SUGGESTION_DESCRIPTION);
    const author: SuggestionAuthor = { kind: 'ai', name: 'AI', userId, userName: (await getUser(userId))?.name ?? '' };
    placed = await insertStructure(boardId, userId, { structure: asked.structure, near, at, target, description }, { author });
  } catch (e) {
    await auditAi(g, userId, { ...meta, ...tokens, outcome: 'not_placed' });
    throw e;
  }
  await auditAi(g, userId, { ...meta, ...tokens, outcome: 'ok', created: placed.created.length, moved: placed.moved.length });
  return { ...placed, task: req.task, summary: asked.summary, usage: asked.usage };
}
