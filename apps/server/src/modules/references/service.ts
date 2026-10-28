// The references index (KAI-149): derived from saved board content through the outbox, read back
// as "what links here" filtered by the reader's live access.
import { formatObjectUri, objectPath, parseObjectUri, type Backlink, type ObjectRef, type ReferenceKind } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, notFound } from '../../platform/http';
import { log } from '../../platform/log';
import { nextDeriveVersion, whileConsumerPaused, type OutboxConsumer } from '../../platform/outbox';
import { allBoardIds } from '../boards/index';
import { can, summarizeObjects, type Actor } from '../objects/index';
import { BOARD_CONTENT_TOPIC, storedBoardView } from '../realtime/index';
import { extractReferences } from './extract';
import * as repo from './repo';

export const REFERENCES_CONSUMER = 'references';
const LOCK_KEY = 7_202_611_031; // arbitrary, constant across releases
const MAX_BACKLINK_ROWS = 2000;
const MAX_BACKLINKS = 200;

/** Freero's own web origins as stored content writes them (PUBLIC_URL); paths and freero:// always count. */
const contentOrigins = (): string[] => {
  const pub = getConfig().publicUrl;
  return pub ? [pub] : [];
};

/**
 * Recomputes everything one board's saved content points at, as of now, and stores it at
 * `version` (an older version never replaces newer rows). Idempotent.
 */
export async function deriveBoardReferences(boardId: string, version: number): Promise<'replaced' | 'stale' | 'gone'> {
  const view = await storedBoardView(boardId);
  const rows = view ? extractReferences(boardId, view, contentOrigins()) : [];
  return repo.replaceReferences(boardId, version, rows);
}

const boardIdOf = (key: string) => (key.startsWith('board:') ? key.slice('board:'.length) : null);

/** The outbox consumer: each batch re-derives the boards whose content was saved. */
export const referencesConsumer: OutboxConsumer = {
  name: REFERENCES_CONSUMER,
  topics: [BOARD_CONTENT_TOPIC],
  lockKey: LOCK_KEY,
  batchSize: 200,
  // A burst of saves of one board (someone typing) becomes one derivation.
  wakeDelayMs: 750,
  async handle(events, { version }) {
    for (const e of events) {
      const id = boardIdOf(e.key);
      if (id) await deriveBoardReferences(id, version);
    }
  },
};

/**
 * Re-derives one board, or every board, from saved content — repair after a restore or a bug
 * fixed in the extraction. Runs while the live consumer is paused, with a version newer than any
 * live batch so far; batches after it are newer again. Returns how many boards were derived.
 */
export async function rebuildReferences(boardId?: string, progress?: (done: number, total: number) => void): Promise<number> {
  return whileConsumerPaused(REFERENCES_CONSUMER, async () => {
    const version = await nextDeriveVersion();
    const ids = boardId ? [boardId] : await allBoardIds();
    let done = 0;
    for (const id of ids) {
      await deriveBoardReferences(id, version);
      if (++done % 500 === 0) progress?.(done, ids.length);
    }
    if (!boardId) log(`references: rebuilt from ${ids.length} board(s)`);
    return done;
  });
}

/**
 * What links to `uri` that `actor` may see. The target itself must be visible to them (else 404:
 * a backlinks call is no way to probe for objects). Each source board is re-checked live with the
 * 'discover' purpose: a board reached only through its link counts once the actor opened it, so
 * the index never hands out ids that a link protects. For a board, its items' references count too.
 */
export async function backlinksOf(actor: Actor, uri: unknown, origins: readonly string[]): Promise<Backlink[]> {
  if (typeof uri !== 'string') throw badRequest('uri is required');
  const target = parseObjectUri(uri, origins);
  if (!target) throw badRequest('uri is not a Freero object address');
  if (!(await can(actor, 'view', target))) throw notFound('Not found');
  const rows = target.type === 'board' ? await repo.referencesToBoard(target.id, MAX_BACKLINK_ROWS) : await repo.referencesTo(formatObjectUri(target), MAX_BACKLINK_ROWS);
  const boards = await summarizeObjects(
    actor,
    [...new Set(rows.map((r) => r.boardId))].map((id): ObjectRef => ({ type: 'board', id })),
    'discover',
  );
  const out = new Map<string, Backlink>();
  for (const r of rows) {
    const board = boards.get(formatObjectUri({ type: 'board', id: r.boardId }));
    if (!board) continue;
    const key = `${r.boardId}\n${r.sourceElement}\n${r.target}`;
    const known = out.get(key);
    if (known) {
      if (!known.kinds.includes(r.kind)) known.kinds.push(r.kind);
      continue;
    }
    if (out.size >= MAX_BACKLINKS) continue;
    const source: ObjectRef = r.sourceElement ? { type: 'element', boardId: r.boardId, id: r.sourceElement } : { type: 'board', id: r.boardId };
    out.set(key, {
      source: {
        uri: formatObjectUri(source),
        type: source.type as 'board' | 'element',
        title: board.title,
        path: objectPath(source)!,
        ...(r.sourceType ? { kind: r.sourceType } : {}),
      },
      board: { id: r.boardId, title: board.title },
      kinds: [r.kind as ReferenceKind],
      target: r.target,
    });
  }
  return [...out.values()];
}
