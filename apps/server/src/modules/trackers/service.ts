// Tracker sync (KAI-153, KAI-154): sending board items to a tracker as ONE issue (or one each),
// importing issues as linked cards, keeping both sides in step, and unlinking.
//
// How a sync runs (syncLink, always from the outbox consumer, so one link is never synced twice at
// once): read the issue from the tracker and the link's items from the live board (as the person
// who linked them sees it), merge field by field against what both sides last agreed on
// (`mergeField` in @freero/shared: one-sided changes flow across; a same-field conflict in one
// window keeps the tracker's value and leaves the board's in a visible comment), write the
// board's changes to the tracker, write the tracker's onto the board through realtime's
// changeBoard ("Jira for Maria", one transaction), refresh the badge and the issue's links back to
// the items, and store the new agreement. Every sync that changed something is in the audit log
// and the activity feed; a failed one too, with why.
//
// What triggers a sync: a saved change of a board with links (`board.content`, when the items'
// values differ from the last agreement or an item is gone), a verified webhook, polling (the
// fallback when webhooks don't reach Freero, and a slow safety net when they do), a retry after a
// failure, or someone asking ("Sync now"). All of them only enqueue `tracker.sync` for the link —
// a webhook's body is never trusted beyond naming the issue: the issue is read back with the
// connection's own credentials.
import type { Request } from 'express';
import {
  baseOf,
  syncedBase,
  trackerAgreed,
  canonical,
  customField,
  fieldsIn,
  issueFieldLabel,
  issueFieldValue,
  withIssueField,
  ISSUE_FIELD_LABELS,
  ISSUE_FIELDS,
  mergeField,
  type FieldMapEntry,
  type TrackerSprint,
  pullableFields,
  TRACKER_COLLECTION,
  TRACKER_PROVIDERS,
  type BoardElement,
  type CardElement,
  type IssueField,
  type IssueValues,
  type RoadmapGroupBy,
  type SyncBase,
  type TrackerImportResponse,
  type TrackerIssuePreview,
  type TrackerIssueRecord,
  type TrackerSendResponse,
  findFreeSpot,
  rotatedBounds,
  clusterBoxes,

  estimateNumber,
  LayoutError,
  translateDraft,
  type ActingApp,
  type ElementDraft,
  type KanbanElement,
  type LaidOut,
} from '@freero/shared';
import { placeLaid, readPlacement } from '../structure/index';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { appendOutbox, type OutboxConsumer } from '../../platform/outbox';
import { rawBody } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { recordAudit } from '../audit/index';
import { findUserByEmail, getAccount, getUser, getUsers } from '../auth/index';
import { getBoardAccess, requireBoardAccess } from '../boards/index';
import {
  BOARD_CONTENT_TOPIC,
  BoardChangeError,
  changeBoard,
  readBoardView,
  storedBoardView,
  type BoardActor,
  type BoardChange,
  type BoardView,
  type SuggestionsDecidedEvent,
} from '../realtime/index';
import {
  applied,
  badgeOf,
  boardValues,
  cardHeight,
  CARD_W,
  importedCard,
  itemUrl,
  noteThread,
  planPull,
  sameBadge,
  SENDABLE_TYPES,
  clusterHeading,
  sourceOf,
  tagsWith,
  unmappedOf,
} from './board';
import { noteOutcome, openConnection, requireUsable, usableConnections, webhookSecretOf } from './connections';
import { ensureWebhooks, hookAddress, hookOfAddress, keepHandshakeSecret, retryWebhooks } from './hooks';
import { emitTrackerActivity } from './events';
import { dayNumber } from './board';
import { planRoadmapImport } from './roadmap';
import { boardPairs, dependencyConnector, pairOf, partsOf, planRelations, type Pair, type RelationPlan } from './relations';
import { importIntoKanban, kanbanOf, personValues, planKanbanImport, statusColumns } from './kanban';
import { TrackerError } from './http';
import { providerOf, type RemoteIssue, type TrackerProvider } from './providers/index';
import * as repo from './repo';
import type { StoredConnection, StoredLink } from './repo';

export const TRACKER_SYNC_TOPIC = 'tracker.sync';
export const TRACKERS_CONSUMER = 'trackers';
const LOCK_KEY = 7_202_611_100; // arbitrary, constant across releases
const MAX_ITEMS_PER_SEND = 50;
const MAX_IMPORT = 100;

const providerName = (c: Pick<StoredConnection, 'provider'>) => TRACKER_PROVIDERS[c.provider];

// ---- people ----

/** Verified email addresses of these people (assignees match trackers by address). */
async function emailsOf(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return out;
  const users = await getUsers(ids);
  for (const id of ids) {
    const u = users.get(id);
    if (!u) continue;
    const account = await getAccount(id).catch(() => null);
    if (account?.emailVerified) out.set(id, u.email.toLowerCase());
  }
  return out;
}

/** The person on this board with that verified address, or null. */
async function boardUserByEmail(boardId: string, email: string): Promise<string | null> {
  const u = await findUserByEmail(email);
  if (!u) return null;
  const account = await getAccount(u.id).catch(() => null);
  if (!account?.emailVerified) return null;
  const access = await getBoardAccess(boardId, u.id);
  return access.role ? u.id : null;
}

/** People a set of items names: card assignees and the person fields of their kanbans. */
const peopleIn = (view: Pick<BoardView, 'elements'>, els: BoardElement[]) =>
  els.flatMap((el) => {
    if (el.type !== 'card') return [];
    const a = (el as { assigneeId?: unknown }).assigneeId;
    const k = kanbanOf(view, el);
    return [...(typeof a === 'string' ? [a] : []), ...(k ? personValues(k, el as CardElement) : [])];
  });

/** The field map a connection syncs with (#43): only where the tracker has custom fields. */
export const fieldMapOf = (conn: Pick<StoredConnection, 'provider' | 'settings'>): FieldMapEntry[] => (providerOf(conn.provider).listFields ? (conn.settings.fieldMap ?? []) : []);

/** The link's items as the mapping reads them, from a board view. */
async function readItems(view: Pick<BoardView, 'elements' | 'collection'>, ids: string[], map: readonly FieldMapEntry[] = []) {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const items = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const missing = ids.filter((id) => !byId.has(id));
  const emails = await emailsOf(peopleIn(view, items));
  const tags = tagsWith(view, {});
  const sources = items.map((el) => sourceOf(el, tags, (id) => emails.get(id) ?? null, (c) => kanbanOf(view, c), map));
  return {
    items,
    missing,
    sources,
    emails,
    heading: clusterHeading(view, items),
  };
}

/** Who writes a link's changes onto the board: the person who linked it, through the tracker. */
async function actorFor(link: Pick<StoredLink, 'boardId' | 'createdBy'>, conn: StoredConnection): Promise<{ actor: BoardActor; workspaceId: string } | 'gone' | 'no_access'> {
  const access = await getBoardAccess(link.boardId, link.createdBy);
  if (!access.exists) return 'gone';
  if (access.role !== 'owner' && access.role !== 'editor') return 'no_access';
  const board = await requireBoardAccess(link.boardId, link.createdBy, 'editor').catch(() => null);
  if (!board) return 'no_access';
  const user = await getUser(link.createdBy);
  return {
    actor: {
      userId: link.createdBy,
      role: board.role,
      name: user?.name ?? undefined,
      via: { kind: 'app', id: `tracker:${conn.id}`, name: providerName(conn) },
    },
    workspaceId: board.workspaceId,
  };
}

// ---- sync ----

/**
 * A link's dependencies on this board (#50): the other links of its connection here, which link
 * each item belongs to, and the pairs involving it on the board (with their connectors), in the
 * tracker and as last agreed.
 */
async function relationState(link: StoredLink, view: Pick<BoardView, 'elements'>, issue: Pick<RemoteIssue, 'relations'> | null) {
  const links = (await repo.linksOfBoard(link.boardId)).filter((l) => l.connectionId === link.connectionId);
  const byId = new Map(links.map((l) => [l.id, l]));
  const byExternal = new Map(links.map((l) => [l.externalId, l.id]));
  const itemLink = new Map<string, string>();
  for (const l of links) for (const s of l.sources) itemLink.set(s, l.id);
  const mine = (p: Pair) => partsOf(p).includes(link.id);
  const onBoard = new Map([...boardPairs(view, (id) => itemLink.get(id))].filter(([p]) => mine(p)));
  const inTracker = new Set<Pair>();
  for (const id of issue?.relations?.blocks ?? []) {
    const other = byExternal.get(id);
    if (other && other !== link.id) inTracker.add(pairOf(link.id, other));
  }
  for (const id of issue?.relations?.blockedBy ?? []) {
    const other = byExternal.get(id);
    if (other && other !== link.id) inTracker.add(pairOf(other, link.id));
  }
  const agreed = new Set((await repo.relationsOf(link.id)).map((r) => pairOf(r.blocker, r.blocked)));
  return { byId, itemLink, onBoard, inTracker, agreed };
}

/** The sprints of an issue's project (#119), or null when the tracker has none or can't say. */
async function sprintsFor(provider: TrackerProvider, pc: ReturnType<typeof openConnection>, issue: Pick<RemoteIssue, 'project'>): Promise<TrackerSprint[] | null> {
  if (!provider.sprints || !issue.project) return null;
  return provider.sprints.list(pc, issue.project).catch(() => null);
}


const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 6 * 3_600_000;
const backoff = (attempts: number, asked: number | null) => Math.max(asked ?? 0, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 12)));

/** Enqueues a sync of these links (one transaction; the consumer picks them up). */
export async function enqueueSync(linkIds: string[]): Promise<void> {
  if (!linkIds.length) return;
  await repo.transaction(async () => {
    for (const id of linkIds) await appendOutbox(TRACKER_SYNC_TOPIC, `link:${id}`);
  });
}

/** Writes a badge (and notes) onto the board as the link's actor; never throws for a board gone. */
async function writeBoard(boardId: string, actor: BoardActor, plan: (view: BoardView) => BoardChange | null) {
  try {
    // Badges live in a server-written collection (sockets and requests can't forge them).
    await changeBoard(boardId, { ...actor, serverCollections: [TRACKER_COLLECTION] }, (view) => {
      const p = plan(view);
      if (p?.update && !p.update.length) delete p.update;
      return { change: p ?? {} };
    });
  } catch (e) {
    if (e instanceof BoardChangeError) throw new TrackerError(`Freero couldn’t write to the board right now (${e.message}).`, 'unavailable');
    throw e;
  }
}

async function failLink(link: StoredLink, conn: StoredConnection, err: unknown, actorInfo: { actor: BoardActor; workspaceId: string } | null): Promise<void> {
  const te = err instanceof TrackerError ? err : null;
  if (!te) logError(`trackers: sync of ${link.externalKey} failed`, err);
  const message = te?.message ?? 'Something went wrong while syncing; Freero will try again.';
  await noteOutcome(conn, err);
  // Credentials refused: nothing to retry until someone fixes the connection (that re-queues).
  const retry = te?.kind === 'auth' ? null : Date.now() + backoff(link.attempts, te?.retryAfterMs ?? null);
  const wasOk = link.state === 'ok';
  await repo.markFailed(link.id, 'error', message, retry);
  if (!wasOk || !actorInfo) return;
  await recordAudit({
    action: 'tracker.sync_failed',
    workspaceId: actorInfo.workspaceId,
    actorId: link.createdBy,
    target: { type: 'tracker_issue', id: link.id, label: link.externalKey },
    metadata: {
      provider: conn.provider,
      issue: link.externalKey,
      reason: message,
    },
  }).catch((e) => logError('trackers: could not record a failed sync', e));
  emitTrackerActivity({
    boardId: link.boardId,
    actorId: link.createdBy,
    action: 'tracker_failed',
    provider: conn.provider,
    issue: link.externalKey,
    reason: message,
  });
  await writeBoard(link.boardId, actorInfo.actor, (view) => {
    const prev = view.collection(TRACKER_COLLECTION).get(link.id) as TrackerIssueRecord | undefined;
    if (!prev) return null;
    return {
      collections: {
        [TRACKER_COLLECTION]: {
          [link.id]: {
            ...prev,
            state: 'error',
            note: message,
            syncedAt: Date.now(),
          },
        },
      },
    };
  }).catch(() => undefined);
}

export interface SyncOutcome {
  pushed: IssueField[];
  pulled: IssueField[];
  conflicts: IssueField[];
  notes: string[];
}

/**
 * Brings one link's issue and items in step (see the top of this file). Idempotent: it reads
 * both sides fresh every time, so running it twice changes nothing the second time.
 */
export async function syncLink(linkId: string): Promise<SyncOutcome | null> {
  // An issue changed in the tracker between Freero's read and its write (a revision conflict):
  // read both sides again and merge once more, never overwrite (#6).
  for (let attempt = 0; ; attempt++) {
    try {
      return await syncLinkOnce(linkId, attempt === 0);
    } catch (e) {
      if (!(e instanceof RevisionConflict) || attempt >= 2) throw e instanceof RevisionConflict ? e.cause : e;
    }
  }
}

/** Thrown out of one sync pass to start another (the cause is reported if passes run out). */
class RevisionConflict extends Error {
  constructor(readonly cause: unknown) {
    super('revision conflict');
  }
}

async function syncLinkOnce(linkId: string, first: boolean): Promise<SyncOutcome | null> {
  const link = await repo.getLink(linkId);
  if (!link) return null;
  const conn = await repo.getConnection(link.connectionId);
  if (!conn) return null;
  const who = await actorFor(link, conn);
  if (who === 'gone') return null;
  if (who === 'no_access') {
    const name = (await getUser(link.createdBy))?.name ?? 'The person who linked it';
    await repo.markFailed(link.id, 'paused', `${name} can no longer edit this board, so syncing ${link.externalKey} is paused.`, null);
    return null;
  }
  // A team's connection only ever syncs that team's boards: the board moved to another workspace (#124).
  if (conn.workspaceId && conn.workspaceId !== who.workspaceId) {
    await repo.markFailed(link.id, 'paused', movedNote(link, conn), null);
    return null;
  }
  if (conn.status === 'needs_auth' || !conn.credentialsSealed) {
    await failLink(link, conn, new TrackerError(`${conn.name} needs to be connected again.`, 'auth'), who);
    return null;
  }
  const provider = providerOf(conn.provider);
  const pc = openConnection(conn);
  try {
    const map = fieldMapOf(conn);
    const view = await readBoardView(link.boardId, who.actor);
    const read = await readItems(view, link.sources, map);

    let issue = await provider.getIssue(pc, link.externalId);
    if (!issue) throw new TrackerError(`${link.externalKey} no longer exists in ${providerName(conn)} (or this connection can’t see it).`, 'not_found', 404);
    const merged = issue;

    // Items deleted from the board leave the link (and the issue's links back); the issue stays.
    if (read.missing.length) await repo.removeSources(link.id, read.missing);
    if (!read.items.length) {
      await provider.setBacklinks(pc, issue, [], link.backlinks).catch(() => undefined);
      await repo.deleteLink(link.id);
      await writeBoard(link.boardId, who.actor, () => ({
        collections: { [TRACKER_COLLECTION]: { [link.id]: null } },
      }));
      await recordAudit({
        action: 'tracker.unlinked',
        workspaceId: who.workspaceId,
        actorId: link.createdBy,
        target: { type: 'tracker_issue', id: link.id, label: link.externalKey },
        metadata: { provider: conn.provider, reason: 'items_deleted' },
      });
      return { pushed: [], pulled: [], conflicts: [], notes: [] };
    }

    const url = (id: string) => itemUrl(link.appOrigin, link.boardId, id);
    const board = boardValues(provider, read.sources, {
      heading: read.heading,
      itemUrl: url,
    });
    const pullable = pullableFields(read.sources, map);
    const synced: IssueField[] = [...ISSUE_FIELDS.filter((f) => provider.fields.includes(f)), ...map.map((m) => customField(m.tracker))];
    const merges = synced.map((f) =>
      mergeField(f, link.base, board, issue!.values, {
        push: true,
        pull: pullable.has(f),
      }),
    );
    const pushed = merges.filter((m) => m.decision === 'push').map((m) => m.field);
    const pulled = merges.filter((m) => m.decision === 'pull').map((m) => m.field);
    const conflicts = merges.filter((m) => m.conflict).map((m) => m.field);
    const notes: string[] = [];

    for (const f of conflicts) {
      const lost = canonical(f, board) ?? '';
      notes.push(
        `${issueFieldLabel(f, map)} of ${issue.key} changed here and in ${providerName(conn)} since the last sync. ${providerName(conn)}’s value was kept${
          f === 'description' || !lost ? '' : `; the board had “${lost.replace(/\n/g, ', ').slice(0, 200)}”`
        }.`,
      );
    }

    if (pushed.length) {
      let patch: IssueValues = {};
      for (const f of pushed) patch = withIssueField(patch, f, issueFieldValue(board, f));
      let written: RemoteIssue | null = null;
      try {
        const out = await provider.updateIssue(pc, issue, patch);
        if (Array.isArray(out)) notes.push(...out);
        else {
          notes.push(...out.notes);
          written = out.issue;
        }
      } catch (e) {
        if (e instanceof TrackerError && e.kind === 'conflict') throw new RevisionConflict(e);
        throw e;
      }
      // The issue as the write left it: the tracker's own answer to the write where it gives one,
      // else read back. A read-back can already hold someone's change made just after the write
      // (a state set in Azure DevOps a moment later): agreed as Freero's own, it would never reach
      // the board.
      issue = written ?? (await provider.getIssue(pc, link.externalId)) ?? issue;
    }

    // Links back to the items: added for new items, removed for items that left.
    const present = read.items.map((el) => el.id);
    const added = present.filter((id) => !link.backlinks.includes(id));
    const removed = link.backlinks.filter((id) => !present.includes(id));
    if (added.length || removed.length)
      await provider.setBacklinks(
        pc,
        issue,
        read.sources.map((s) => ({
          itemId: s.id,
          url: url(s.id),
          title: (s.title || s.text || 'Board item').slice(0, 200),
        })),
        removed,
      );

    // Dependencies (#50): a "blocks" link made or removed on one side since the last agreement goes
    // to the other — the tracker's writes here, the board's connectors in the change below.
    let relations: (Awaited<ReturnType<typeof relationState>> & { plan: RelationPlan }) | null = null;
    if (provider.dependencies && conn.settings.dependencies && issue.relations) {
      const st = await relationState(link, view, issue);
      const plan = planRelations(new Set(st.onBoard.keys()), st.inTracker, st.agreed);
      const ext = (id: string) => st.byId.get(id)?.externalId ?? '';
      for (const p of plan.add) await provider.dependencies.add(pc, ext(partsOf(p)[0]), ext(partsOf(p)[1]));
      for (const p of plan.remove) await provider.dependencies.remove(pc, ext(partsOf(p)[0]), ext(partsOf(p)[1]));
      relations = { ...st, plan };
    }

    // The tracker's side onto the board, plus the badge and notes, in one change.
    let pull: IssueValues = {};
    for (const f of pulled) pull = withIssueField(pull, f, issueFieldValue(issue.values, f));
    const userIdOf = new Map<string, string>();
    const personEmails = [pull.assignee, ...map.filter((m) => m.type === 'person').map((m) => pull.custom?.[m.tracker])];
    for (const e of personEmails)
      if (typeof e === 'string' && !e.startsWith('~') && !userIdOf.has(e)) {
        const id = await boardUserByEmail(link.boardId, e);
        if (id) userIdOf.set(e, id);
      }
    // A sprint pulled onto a kanban: the project's sprints tell which are closed (read-only there).
    const sprints = pull.sprint !== undefined ? await sprintsFor(provider, pc, issue) : null;
    const sources = present;
    let boardAfter: IssueValues = board;
    const finalIssue = issue;
    const author = {
      id: link.createdBy,
      name: who.actor.name ? `${providerName(conn)} for ${who.actor.name}` : providerName(conn),
    };
    await writeBoard(link.boardId, who.actor, (live) => {
      const liveItems = sources.flatMap((id) => {
        const hit = live.elements.find((e) => e.el.id === id);
        return hit ? [hit.el] : [];
      });
      const plan = planPull(live, liveItems, pull, {
        fields: pullable,
        provider,
        previousLabels: (link.base.tracker.labels ?? '').split('\n').filter(Boolean),
        userIdOf: (e) => userIdOf.get(e) ?? null,
        newId: () => newId(10),
        sprints,
        map,
      });
      notes.push(...plan.notes);
      const after = applied(liveItems, plan);
      const emails = new Map(read.emails);
      for (const [e, id] of userIdOf) emails.set(id, e);
      const tags = tagsWith(live, plan.tags);
      // The board as this change leaves it (a kanban that gained a priority level reads it).
      const patched = new Map(plan.update.map((u) => [u.id, u.patch]));
      const liveAfter = { elements: live.elements.map((e) => (patched.has(e.el.id) ? { el: { ...e.el, ...patched.get(e.el.id) } as BoardElement } : e)) };
      boardAfter = boardValues(
        provider,
        after.map((el) => sourceOf(el, tags, (id) => emails.get(id) ?? null, (c) => kanbanOf(liveAfter, c), map)),
        { heading: clusterHeading(live, after), itemUrl: url },
      );
      const prev = live.collection(TRACKER_COLLECTION).get(link.id) as TrackerIssueRecord | undefined;
      const badge = badgeOf(conn, { key: link.externalKey, url: link.externalUrl, sources }, finalIssue, 'ok', notes.length ? notes[notes.length - 1] : null, prev);
      const marks = liveItems.filter((el) => el.trackerLink !== link.id).map((el) => ({ id: el.id, patch: { trackerLink: link.id } }));
      const update = [...plan.update, ...marks];
      const collections: Record<string, Record<string, unknown>> = {};
      if (!sameBadge(prev, badge) || update.length || notes.length) collections[TRACKER_COLLECTION] = { [link.id]: badge };
      if (Object.keys(plan.tags).length) collections.tags = plan.tags;
      if (notes.length && liveItems[0])
        collections.comments = noteThread(liveItems[0], author, `${providerName(conn)} sync: ${notes.join(' ')}`, { thread: newId(12), message: newId(12) });
      // Dependencies the tracker made or removed: connectors drawn between the cards, or taken off.
      const create: ElementDraft[] = [];
      const remove: string[] = [];
      if (relations && (relations.plan.draw.length || relations.plan.erase.length)) {
        const now = boardPairs(live, (id) => relations!.itemLink.get(id));
        const cardOf = (linkId: string) => (relations!.byId.get(linkId)?.sources ?? []).map((id) => live.elements.find((e) => e.el.id === id)?.el).find((el) => el?.type === 'card');
        for (const p of relations.plan.draw) {
          const [a, b] = partsOf(p);
          const from = cardOf(a);
          const to = cardOf(b);
          if (from && to && !now.has(p)) create.push(dependencyConnector(newId(10), from, to));
        }
        for (const p of relations.plan.erase) remove.push(...(now.get(p) ?? []));
      }
      if (!update.length && !Object.keys(collections).length && !create.length && !remove.length) return null;
      return { update, collections, ...(create.length ? { create } : {}), ...(remove.length ? { remove } : {}) };
    });
    // Agreed once both sides hold them: a dependency changed on either side meanwhile is the next sync's.
    if (relations) await repo.setRelations(link.id, relations.plan.agreed.map((p) => ({ blocker: partsOf(p)[0], blocked: partsOf(p)[1] })));

    // Fields this sync didn't pull are agreed as it read them: a change made on the board while it
    // ran (a bar dragged right after an import) is still sent by the next sync, never swallowed.
    // …and the tracker's fields this sync didn't write are agreed as it merged them: a change made
    // in the tracker between Freero's write and its read-back is pulled by the next sync.
    const base: SyncBase = syncedBase(board, boardAfter, pulled, trackerAgreed(merged.values, finalIssue.values, [...pushed, ...pulled]), link.base);
    await repo.markSynced(link.id, base, present);
    await noteOutcome(conn, null);

    const dependencies = relations ? { sent: relations.plan.add.length + relations.plan.remove.length, received: relations.plan.draw.length + relations.plan.erase.length } : null;
    if (pushed.length || pulled.length || conflicts.length || (dependencies && (dependencies.sent || dependencies.received))) {
      await recordAudit({
        action: 'tracker.synced',
        workspaceId: who.workspaceId,
        actorId: link.createdBy,
        target: { type: 'tracker_issue', id: link.id, label: link.externalKey },
        metadata: {
          provider: conn.provider,
          issue: link.externalKey,
          pushed,
          pulled,
          conflicts,
          ...(dependencies && (dependencies.sent || dependencies.received) ? { dependenciesSent: dependencies.sent, dependenciesReceived: dependencies.received } : {}),
        },
      });
      if (pushed.length)
        emitTrackerActivity({
          boardId: link.boardId,
          actorId: link.createdBy,
          action: 'tracker_synced',
          provider: conn.provider,
          issue: link.externalKey,
          fields: pushed.map((f) => issueFieldLabel(f, map).toLowerCase()),
        });
    }
    return { pushed, pulled, conflicts, notes };
  } catch (e) {
    if (e instanceof RevisionConflict && first) throw e;
    if (e instanceof RevisionConflict) {
      // Passes ran out: report it like any failure (the retry tries again later).
      await failLink(link, conn, e.cause, who);
      return null;
    }
    await failLink(link, conn, e, who);
    if (!(e instanceof TrackerError)) throw e;
    return null;
  }
}

/**
 * Whether a saved board change touches this link: an item gone, or the items' values differ from
 * what both sides last agreed (read from the saved board, without loading a live room).
 */
async function boardSideChanged(link: StoredLink, conn: StoredConnection, view: BoardView | null): Promise<boolean> {
  if (!view) return false;
  const read = await readItems(view, link.sources, fieldMapOf(conn));
  if (read.missing.length) return true;
  const provider = providerOf(conn.provider);
  const board = boardValues(provider, read.sources, {
    heading: read.heading,
    itemUrl: (id) => itemUrl(link.appOrigin, link.boardId, id),
  });
  const changed = fieldsIn(board).some((f) => {
    const now = canonical(f, board);
    return now !== undefined && link.base.board[f] !== undefined && now !== link.base.board[f];
  });
  if (changed || !provider.dependencies || !conn.settings.dependencies) return changed;
  // A dependency connector drawn or removed between this link's cards and another's (#50).
  const st = await relationState(link, view, null);
  return st.onBoard.size !== st.agreed.size || [...st.onBoard.keys()].some((p) => !st.agreed.has(p));
}

/** The outbox consumer: saved board changes and queued syncs, one at a time (one instance). */
export const trackersConsumer: OutboxConsumer = {
  name: TRACKERS_CONSUMER,
  topics: [BOARD_CONTENT_TOPIC, TRACKER_SYNC_TOPIC],
  lockKey: LOCK_KEY,
  batchSize: 100,
  wakeDelayMs: 500,
  async handle(events) {
    const toSync = new Set<string>();
    // Boards with accepted proposed cards to link (#82): queued by the decision, or retried when a
    // saved change brings a card that wasn't on the board yet.
    const toLink = new Set<string>();
    for (const e of events) {
      if (e.key.startsWith('link:')) toSync.add(e.key.slice('link:'.length));
      else if (e.key.startsWith('proposals:')) toLink.add(e.key.slice('proposals:'.length));
      else if (e.topic === BOARD_CONTENT_TOPIC && e.key.startsWith('board:')) {
        const boardId = e.key.slice('board:'.length);
        if (await repo.boardHasProposalsToLink(boardId)) toLink.add(boardId);
        if (!(await repo.boardHasLinks(boardId))) continue;
        const view = await storedBoardView(boardId);
        for (const link of await repo.linksOfBoard(boardId)) {
          const conn = await repo.getConnection(link.connectionId);
          if (conn && (await boardSideChanged(link, conn, view))) toSync.add(link.id);
        }
      }
    }
    for (const boardId of toLink) for (const id of await linkAcceptedProposals(boardId)) toSync.add(id);
    for (const id of toSync) await syncLink(id);
  },
};

// ---- polling and retries (exclusive job) ----

/** Queues links whose retry is due and polls connections that are due; returns how many were queued. */
export async function pollOnce(now = Date.now()): Promise<number> {
  const cfg = getConfig().trackers;
  const queued = new Set(await repo.claimRetries(now));
  // Webhooks Freero registers itself (Asana, monday.com, ClickUp, Trello) that failed a while ago are tried again.
  await retryWebhooks(now).catch((e) => logError('trackers: registering webhooks again failed', e));
  for (const conn of await repo.connectionsWithLinks()) {
    if (conn.status === 'needs_auth' || !conn.credentialsSealed) continue;
    if (conn.cooldownUntil && conn.cooldownUntil > now) continue;
    const every = conn.inbound === 'polling' ? cfg.pollMs : cfg.fallbackPollMs;
    if (conn.polledAt && now - conn.polledAt < every) continue;
    const links = (await repo.linksOfConnection(conn.id)).filter((l) => l.state !== 'paused');
    // A minute of overlap: an edit landing while the last poll ran is seen by this one.
    const since = (conn.polledAt ?? now - every) - 60_000;
    try {
      const changed = new Set(
        await providerOf(conn.provider).changedSince(
          openConnection(conn),
          links.map((l) => ({ id: l.externalId, key: l.externalKey })),
          since,
        ),
      );
      for (const l of links) if (changed.has(l.externalId) || changed.has(l.externalKey)) queued.add(l.id);
      await repo.setPolled(conn.id, now);
      await noteOutcome(conn, null);
    } catch (e) {
      await noteOutcome(conn, e);
      if (!(e instanceof TrackerError)) logError(`trackers: polling ${conn.name} failed`, e);
    }
  }
  await enqueueSync([...queued]);
  return queued.size;
}

// ---- webhooks ----

/**
 * A delivery from the tracker: verified with the connection's secret, then only the issues it
 * names are queued for a sync (which reads them back itself). 401 for a bad signature, so a
 * misconfigured secret shows up in the tracker's delivery log. For a webhook Freero registered
 * itself (Asana, monday.com) the address must be one Freero made (hooks.ts), and a handshake is
 * answered — never queued — only while Freero is registering it.
 */
export async function receiveWebhook(
  connectionId: string,
  req: Request,
): Promise<{ queued: number; reply?: undefined } | { reply: { headers?: Record<string, string>; body?: unknown } }> {
  const conn = await repo.getConnection(connectionId);
  if (!conn) throw notFound('No such tracker connection');
  const secret = webhookSecretOf(conn);
  const body = rawBody(req);
  const provider = providerOf(conn.provider);
  const refused = () => new HttpError(401, 'The webhook could not be verified');
  if (!secret) throw refused();
  const hook = provider.webhooks ? await hookOfAddress(conn, secret, req.query as Record<string, unknown>) : null;
  if (provider.webhooks && !hook) throw refused();
  const delivery = provider.webhook({
    headers: req.headers,
    rawBody: body ?? Buffer.alloc(0),
    secret,
    now: Date.now(),
    ...(hook ? { hook: { pending: hook.pending, secret: hook.secret, address: hookAddress(hook.row.appOrigin, conn.id, hook.row.id, secret) } } : {}),
  });
  if (!delivery) throw refused();
  if (delivery.handshake) {
    if (delivery.handshake.keep !== undefined && (!hook || !(await keepHandshakeSecret(hook.row, delivery.handshake.keep)))) throw refused();
    return { reply: { headers: delivery.handshake.headers, body: delivery.handshake.body } };
  }
  const links = await repo.linksToIssues(conn.id, delivery.issues);
  await enqueueSync(links.map((l) => l.id));
  return { queued: links.length };
}

/** Whether an address names a webhook Freero is registering right now (Trello's HEAD check). */
export async function webhookAddressPending(connectionId: string, query: Record<string, unknown>): Promise<boolean> {
  const conn = await repo.getConnection(connectionId);
  const secret = conn ? webhookSecretOf(conn) : null;
  if (!conn || !secret || !providerOf(conn.provider).webhooks) return false;
  return (await hookOfAddress(conn, secret, query))?.pending ?? false;
}

// ---- send, preview, import, unlink ----

function itemIdsOf(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw badRequest('itemIds must list the items to send');
  if (v.length > MAX_ITEMS_PER_SEND) throw badRequest(`At most ${MAX_ITEMS_PER_SEND} items at once`);
  const ids = [...new Set(v.map((x) => (typeof x === 'string' ? x : '')))];
  if (ids.some((id) => !id || id.length > 64)) throw badRequest('itemIds must be item ids');
  return ids;
}

async function sendContext(userId: string, boardId: string, body: Record<string, unknown>, origin: string) {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(body.connectionId, board.workspaceId, userId);
  const ids = itemIdsOf(body.itemIds);
  const view = await readBoardView(boardId, { userId, role: board.role });
  const read = await readItems(view, ids, fieldMapOf(conn));
  if (read.missing.length) throw notFound(read.missing.length === 1 ? 'That item isn’t on this board any more' : 'Some of those items aren’t on this board any more');
  const odd = read.items.find((el) => !SENDABLE_TYPES.has(el.type));
  if (odd) throw badRequest(`A ${odd.type} can’t become part of an issue: send sticky notes, cards, shapes or text`);
  const mode = body.mode === 'each' ? 'each' : body.mode === 'clusters' ? 'clusters' : 'one';
  const provider = providerOf(conn.provider);
  const parentKey = typeof body.parent === 'string' && body.parent.trim() ? body.parent.trim() : null;
  if (parentKey && (parentKey.length > 100 || /[\s"']/.test(parentKey))) throw badRequest('parent must be an issue key');
  if ((mode === 'clusters' || parentKey) && !provider.parents) throw badRequest(`${providerName(conn)} issues can’t be put under a parent from Freero`);
  // A frame of clusters (#43): one child issue per cluster, under one parent made for them all.
  const groups = mode === 'each' ? read.items.map((el) => [el]) : mode === 'clusters' ? clustersOf(read.items) : [read.items];
  const parent =
    mode === 'clusters'
      ? {
          // The frame's title or the heading above them, else what the first cluster is called.
          title: (clusterHeading(view, read.items, { frame: true }) ?? clusterHeading(view, groups[0], { frame: false }) ?? read.sources.find((x) => x.id === groups[0][0].id)?.title) || 'Untitled',
          description: [
            `From ${groups.length} cluster${groups.length === 1 ? '' : 's'} on a Freero board:`,
            '',
            ...groups.map((g) => `- ${(clusterHeading(view, g, { frame: false }) ?? read.sources.find((s) => s.id === g[0].id)?.title) || 'Untitled'} ([open](${itemUrl(origin, boardId, g[0].id)}))`),
          ].join('\n'),
        }
      : null;
  return { board, conn, view, read, groups, parent, parentKey, clusters: mode === 'clusters' };
}

/** Items close together, as the board outline groups them (each a cluster; reading order kept). */
function clustersOf(items: BoardElement[]): BoardElement[][] {
  const groups = clusterBoxes(items.map((el) => rotatedBounds(el)));
  return groups.map((g) => [...g].sort((a, b) => a - b).map((i) => items[i])).sort((a, b) => items.indexOf(a[0]) - items.indexOf(b[0]));
}

function groupValues(provider: TrackerProvider, view: BoardView, read: Awaited<ReturnType<typeof readItems>>, group: BoardElement[], origin: string, boardId: string, clusters = false) {
  const sources = group.map((el) => read.sources.find((s) => s.id === el.id)!);
  const heading = group.length > 1 ? clusterHeading(view, group, { frame: !clusters }) : null;
  return {
    sources,
    values: boardValues(provider, sources, {
      heading,
      itemUrl: (id) => itemUrl(origin, boardId, id),
    }),
  };
}

/** Exactly what Send would create, nothing written anywhere. */
export async function previewSend(userId: string, boardId: string, body: Record<string, unknown>, origin: string): Promise<TrackerIssuePreview[]> {
  const ctx = await sendContext(userId, boardId, body, origin);
  const { conn, view, read, groups, parent } = ctx;
  const provider = providerOf(conn.provider);
  const out = groups.map((group) => {
    const { sources, values } = groupValues(provider, view, read, group, origin, boardId, ctx.clusters);
    const unmapped = unmappedOf(provider, sources);
    for (const el of group) {
      const est = (el as { estimate?: unknown }).estimate;
      if (el.type === 'card' && typeof est === 'string' && est.trim() && estimateNumber(est) === null) unmapped.push(`Estimate “${est.slice(0, 20)}” (not a number)`);
    }
    return { itemIds: group.map((el) => el.id), values, unmapped };
  });
  // The parent first (it links to no item: its children do).
  return parent ? [{ itemIds: [], values: parent, unmapped: [] }, ...out] : out;
}

/**
 * Creates one issue for the items (or one per item) and links them: the badge on every item, the
 * issue's links back to each of them. The board side is ONE change, attributed to the tracker
 * for the person; nothing on the board changes when the tracker refuses.
 */
export async function sendToTracker(userId: string, boardId: string, body: Record<string, unknown>, origin: string): Promise<TrackerSendResponse> {
  const ctx = await sendContext(userId, boardId, body, origin);
  const { conn, view, read, groups, board, parent } = ctx;
  const linked = await repo.linkedItems(
    boardId,
    read.items.map((el) => el.id),
  );
  if (linked.size) throw new HttpError(409, `${linked.size === 1 ? 'That item is' : `${linked.size} of those items are`} already linked to an issue`, 'tracker_already_linked');
  const project = typeof body.project === 'string' && body.project.trim() ? body.project.trim().slice(0, 200) : (conn.settings.project ?? null);
  if (!project) throw badRequest('project is required');
  const issueType = typeof body.issueType === 'string' && body.issueType.trim() ? body.issueType.trim().slice(0, 100) : (conn.settings.issueTypes?.[project] ?? conn.settings.issueType ?? null);
  await consumeRateLimit('trackerSend', userId);
  const provider = providerOf(conn.provider);
  const pc = openConnection(conn);
  const user = await getUser(userId);
  const actor: BoardActor = {
    userId,
    role: board.role,
    name: user?.name,
    via: { kind: 'app', id: `tracker:${conn.id}`, name: providerName(conn) },
  };

  const made: Array<{
    link: StoredLink;
    issue: RemoteIssue;
    notes: string[];
    group: BoardElement[];
  }> = [];
  let failure: unknown = null;
  let parentKey = ctx.parentKey;
  let madeParent: RemoteIssue | null = null;
  if (parent) {
    try {
      madeParent = (await provider.createIssue(pc, { project, issueType: provider.parents?.issueType ?? null, values: parent })).issue;
      parentKey = madeParent.key;
    } catch (e) {
      failure = e;
    }
  }
  for (const group of failure ? [] : groups) {
    try {
      const { values } = groupValues(provider, view, read, group, origin, boardId, ctx.clusters);
      const { issue, notes } = await provider.createIssue(pc, {
        project,
        issueType,
        values,
        parent: parentKey,
      });
      const url = (id: string) => itemUrl(origin, boardId, id);
      await provider
        .setBacklinks(
          pc,
          issue,
          group.map((el) => ({
            itemId: el.id,
            url: url(el.id),
            title: (read.sources.find((s) => s.id === el.id)?.title || 'Board item').slice(0, 200),
          })),
          [],
        )
        .catch((e) => notes.push(e instanceof TrackerError ? e.message : 'The links back to the board couldn’t be added; the next sync tries again.'));
      const after = (await provider.getIssue(pc, issue.id)) ?? issue;
      const link: StoredLink = {
        id: newId(16),
        connectionId: conn.id,
        boardId,
        externalId: after.id,
        externalKey: after.key,
        externalUrl: after.url,
        createdBy: userId,
        appOrigin: origin,
        base: baseOf(values, after.values),
        backlinks: group.map((el) => el.id),
        state: 'ok',
        lastError: null,
        attempts: 0,
        retryAt: null,
        syncedAt: Date.now(),
        createdAt: Date.now(),
        sources: group.map((el) => el.id),
      };
      await repo.insertLink(link);
      made.push({ link, issue: after, notes, group });
    } catch (e) {
      failure = e;
      break;
    }
  }
  await noteOutcome(conn, failure);

  if (made.length) {
    await writeBoard(boardId, actor, (live) => {
      const update: Array<{ id: string; patch: Record<string, unknown> }> = [];
      const badges: Record<string, unknown> = {};
      const comments: Record<string, unknown> = {};
      for (const m of made) {
        for (const el of m.group) if (live.elements.some((e) => e.el.id === el.id)) update.push({ id: el.id, patch: { trackerLink: m.link.id } });
        badges[m.link.id] = badgeOf(
          conn,
          {
            key: m.link.externalKey,
            url: m.link.externalUrl,
            sources: m.link.sources,
          },
          m.issue,
          'ok',
          m.notes.at(-1) ?? null,
        );
        const first = live.elements.find((e) => e.el.id === m.group[0].id)?.el;
        if (m.notes.length && first)
          Object.assign(
            comments,
            noteThread(
              first,
              {
                id: userId,
                name: `${providerName(conn)} for ${user?.name ?? 'you'}`,
              },
              `${providerName(conn)}: ${m.notes.join(' ')}`,
              { thread: newId(12), message: newId(12) },
            ),
          );
      }
      return {
        update,
        collections: {
          [TRACKER_COLLECTION]: badges,
          ...(Object.keys(comments).length ? { comments } : {}),
        },
      };
    });
    for (const m of made) {
      await recordAudit({
        action: 'tracker.issue_created',
        workspaceId: board.workspaceId,
        target: {
          type: 'tracker_issue',
          id: m.link.id,
          label: m.link.externalKey,
        },
        metadata: {
          provider: conn.provider,
          connection: conn.id,
          issue: m.link.externalKey,
          items: m.group.length,
        },
      });
      const items: Record<string, number> = {};
      for (const el of m.group) items[el.type] = (items[el.type] ?? 0) + 1;
      emitTrackerActivity({
        boardId,
        actorId: userId,
        action: 'tracker_sent',
        provider: conn.provider,
        issue: m.link.externalKey,
        items,
      });
    }
  }
  if (failure) {
    const what = failure instanceof TrackerError ? failure.message : 'Something went wrong while creating the issue.';
    if (!(failure instanceof TrackerError)) logError('trackers: sending items failed', failure);
    if (failure instanceof repo.ItemAlreadyLinkedError) throw new HttpError(409, 'Those items were linked meanwhile', 'tracker_already_linked');
    const keys = [...(madeParent ? [madeParent.key] : []), ...made.map((m) => m.link.externalKey)];
    throw new HttpError(failure instanceof TrackerError && failure.kind === 'invalid' ? 400 : 502, keys.length ? `Created ${keys.join(', ')}; then: ${what}` : what, 'tracker_refused');
  }
  if (made.length) void ensureWebhooks(conn, [project, ...made.map((m) => m.issue.project)], origin);
  return {
    issues: made.map((m) => ({
      linkId: m.link.id,
      key: m.link.externalKey,
      url: m.link.externalUrl,
      itemIds: m.link.sources,
    })),
    ...(madeParent ? { parent: { key: madeParent.key, url: madeParent.url } } : {}),
  };
}

/**
 * Issues matching a query become linked task cards in free space, laid out in a grid. Issues
 * already on this board through the same connection are skipped, so importing twice adds nothing.
 */
export async function importIssues(
  userId: string,
  boardId: string,
  body: Record<string, unknown>,
  origin: string,
  opts: { via?: ActingApp; preflight?: () => Promise<void> } = {},
): Promise<TrackerImportResponse> {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(body.connectionId, board.workspaceId, userId);
  const what = importQuery(body);
  const limit = typeof body.limit === 'number' && Number.isInteger(body.limit) ? Math.max(1, Math.min(MAX_IMPORT, body.limit)) : 50;
  // Roadmap mode (KAI-160): onto a timeline the person can see and change.
  const target = roadmapTarget(body.timeline);
  // Or into a frame / kanban (column) / cluster, or a new frame or kanban (placement by meaning).
  const placement = body.placement === undefined || body.placement === null ? null : readPlacement(body.placement);
  if (placement && target) throw badRequest('Give timeline or placement, not both');
  if (placement) {
    // Checked against the board before the tracker is asked (a wrong id costs nothing).
    const v0 = await readBoardView(boardId, { userId, role: board.role });
    try {
      placeLaid(probeLaid(), placement, v0, { newId: () => newId(10), obstacles: [], travelling: new Set(), keepStatus: true });
    } catch (e) {
      if (e instanceof LayoutError) throw badRequest(e.message);
      throw e;
    }
  }
  await opts.preflight?.();
  if (target) {
    const v0 = await readBoardView(boardId, { userId, role: board.role });
    const tl = v0.elements.find((e) => e.el.id === target.id)?.el;
    if (!tl || tl.type !== 'timeline') throw badRequest('That timeline isn’t on this board');
    if (tl.locked) throw badRequest('That timeline is locked');
  }
  const provider = providerOf(conn.provider);
  const map = fieldMapOf(conn);
  const { issues, fresh, sprints: scopeSprints } = await searchNew(userId, boardId, conn, what, limit);
  if (!fresh.length) return { created: [], skipped: issues.length, cards: [] };

  // People and tags the cards need, resolved before the board is written.
  const assignee = new Map<string, string | null>();
  for (const i of fresh) {
    const people = [i.values.assignee, ...map.filter((m) => m.type === 'person').map((m) => i.values.custom?.[m.tracker])];
    for (const a of people) if (typeof a === 'string' && a && !a.startsWith('~') && !assignee.has(a)) assignee.set(a, await boardUserByEmail(boardId, a));
  }
  // A kanban's Priority options are the tracker's levels (asked only when an issue has a priority).
  const priorities = placement && fresh.some((i) => i.values.priority) && provider.priorities ? await provider.priorities(openConnection(conn)).catch(() => null) : null;
  // Its Sprint options are the project's sprints (#119): known from an import by sprint, else asked
  // when an issue has one.
  const sprintProject = what.scope?.project ?? fresh.find((i) => i.values.sprint)?.project ?? null;
  const sprints =
    placement && provider.sprints && (what.scope?.sprint || fresh.some((i) => i.values.sprint))
      ? (scopeSprints ?? (sprintProject ? await provider.sprints.list(openConnection(conn), sprintProject).catch(() => null) : null))
      : null;
  const kanbanCtx = {
    priorities,
    sprints,
    sprintFieldName: provider.sprints?.fieldName,
    map,
    userIdOf: (e: string) => assignee.get(e) ?? null,
  };
  const user = await getUser(userId);
  const actor: BoardActor = {
    userId,
    role: board.role,
    name: user?.name,
    // An agent's import is the agent's ("Claude for Maria"); later syncs are the tracker's.
    via: opts.via ?? { kind: 'app', id: `tracker:${conn.id}`, name: providerName(conn) },
  };
  const links: StoredLink[] = fresh.map((i) => ({
    id: newId(16),
    connectionId: conn.id,
    boardId,
    externalId: i.id,
    externalKey: i.key,
    externalUrl: i.url,
    createdBy: userId,
    appOrigin: origin,
    base: { board: {}, tracker: {} },
    backlinks: [],
    state: 'ok',
    lastError: null,
    attempts: 0,
    retryAt: null,
    syncedAt: Date.now(),
    createdAt: Date.now(),
    sources: [newId(14)],
  }));
  const inserted: StoredLink[] = [];
  for (const l of links) {
    try {
      await repo.insertLink(l);
      inserted.push(l);
    } catch (e) {
      if (!(e instanceof repo.IssueAlreadyLinkedError)) throw e;
    }
  }
  const created: string[] = [];
  let unscheduled = 0;
  let containerId: string | undefined;
  try {
    await writeBoard(boardId, actor, (live) => {
      const tags = new Map([...(live.collection('tags') as ReadonlyMap<string, { name?: string }>)].map(([id, t]) => [provider.label(t?.name ?? '').toLowerCase(), id]));
      const newTags: Record<string, { id: string; name: string; color: string }> = {};
      const tagId = (label: string) => {
        const k = provider.label(label).toLowerCase();
        let id = tags.get(k);
        if (!id) {
          id = newId(10);
          tags.set(k, id);
          newTags[id] = { id, name: label, color: '#5B3FF0' };
        }
        return id;
      };
      const timeline = target ? live.elements.find((e) => e.el.id === target.id && e.el.type === 'timeline')?.el : undefined;
      const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(inserted.length))));
      const heights = inserted.map((l) => {
        const i = fresh.find((x) => x.id === l.externalId)!;
        return cardHeight(i.values.title, i.values.description.slice(0, 300));
      });
      const rowH = Math.max(...heights) + 24;
      const rows = Math.ceil(inserted.length / cols);
      const block = { w: cols * (CARD_W + 24) - 24, h: rows * rowH - 24 };
      const obstacles = live.elements.map((e) => rotatedBounds(e.el));
      const center = obstacles.length
        ? {
            x: obstacles.reduce((s, r) => s + r.x + r.w / 2, 0) / obstacles.length,
            y: obstacles.reduce((s, r) => s + r.y + r.h / 2, 0) / obstacles.length,
          }
        : { x: 0, y: 0 };
      const at = findFreeSpot(obstacles, block, center, 40);
      const create = inserted.map((l, n) => {
        const i = fresh.find((x) => x.id === l.externalId)!;
        const pos = {
          x: at.x + (n % cols) * (CARD_W + 24),
          y: at.y + Math.floor(n / cols) * rowH,
        };
        const a = i.values.assignee;
        created.push(l.sources[0]);
        return importedCard(l.sources[0], pos, i, {
          linkId: l.id,
          assigneeId: a ? (assignee.get(a) ?? null) : null,
          tagIds: i.values.labels.map(tagId),
          h: heights[n],
        });
      });
      const badges = Object.fromEntries(
        inserted.map((l) => [
          l.id,
          badgeOf(
            conn,
            { key: l.externalKey, url: l.externalUrl, sources: l.sources },
            fresh.find((x) => x.id === l.externalId)!,
            'ok',
            null,
          ),
        ]),
      );
      const collections = {
        [TRACKER_COLLECTION]: badges,
        ...(Object.keys(newTags).length ? { tags: newTags } : {}),
      };
      if (timeline?.type === 'timeline' && target) {
        const frames = live.elements.map((e) => e.el).filter((el) => el.type === 'frame');
        const roadmap = planRoadmapImport(
          live,
          timeline,
          inserted.map((l, n) => ({ id: l.sources[0], issue: fresh.find((x) => x.id === l.externalId)!, draft: create[n] })),
          {
            groupBy: target.groupBy,
            today: dayNumber(Date.now()),
            newId: () => newId(10),
            frameIndex: frames.reduce((m, f) => Math.max(m, Number((f as { index?: number }).index) || 0), -1) + 1,
          },
        );
        unscheduled = roadmap.unscheduled;
        return { create: roadmap.create, update: roadmap.update, collections };
      }
      if (placement) {
        // The grid from (0, 0), then where the placement says (the structure module's rules).
        const laid: LaidOut = {
          elements: create.map((d) => translateDraft(d, -at.x, -at.y)),
          content: {},
          moves: [],
          size: block,
          parts: [{ ids: create.map((d) => d.id) }],
        };
        // Into a kanban: each issue's status picks its column by name and its priority the
        // kanban's Priority field (kanban.ts), adding the columns / field it lacks.
        const imported = inserted.map((l) => ({ id: l.sources[0], values: fresh.find((x) => x.id === l.externalId)!.values }));
        const target = kanbanTargetOf(live, placement);
        const ids = () => newId(10);
        let view: BoardView = live;
        let plan: ReturnType<typeof planKanbanImport> | null = null;
        let columnFor: ((id: string) => string | undefined) | undefined;
        let newKanbanColumns: ReturnType<typeof statusColumns> | undefined;
        if (target === 'new') {
          newKanbanColumns = statusColumns(imported);
          const titleOf = new Map(imported.map((i) => [i.id, i.values.statusName?.trim() || undefined]));
          columnFor = (id) => titleOf.get(id);
        } else if (target) {
          const p = planKanbanImport(target.k, imported, { newId: ids, ...kanbanCtx });
          plan = p;
          view = { ...live, elements: live.elements.map((e) => (e.el.id === target.k.id ? { ...e, el: p.kanban } : e)) };
          // A column the request names keeps the usual rule (the column, unless the status says otherwise).
          if (target.column === undefined) columnFor = (id) => p.columnOf.get(id);
        }
        const placed = placeLaid(laid, placement, view, { newId: ids, obstacles, travelling: new Set(), keepStatus: true, columnFor, newKanbanColumns });
        containerId = placed.containerId;
        let elements = placed.elements;
        if (target === 'new' && containerId) {
          const k = elements.find((d) => d.id === containerId) as unknown as KanbanElement;
          const p = planKanbanImport(k, imported, { newId: ids, ...kanbanCtx });
          plan = p;
          elements = elements.map((d) => (d.id === containerId ? ({ ...d, ...p.patch } as ElementDraft) : d));
        }
        if (plan) {
          const values = plan.values;
          elements = elements.map((d) => (values.has(d.id) ? ({ ...d, values: values.get(d.id) } as ElementDraft) : d));
        }
        // Into a kanban that was there: its new columns / fields, the cards already there kept in
        // their columns, and the kanban laid out as open boards would after this drop (kanban.ts).
        if (target && target !== 'new') return { ...importIntoKanban(live.elements.map((e) => e.el), target.k, plan, { create: elements, update: [...placed.grow] }), collections };
        return { create: elements, update: [...placed.grow], collections };
      }
      return { create, collections };
    });
  } catch (e) {
    for (const l of inserted) await repo.deleteLink(l.id);
    throw e;
  }
  // What both sides agree on now: the cards hold the issues' values (as read back from the board).
  const view = await readBoardView(boardId, { userId, role: board.role });
  for (const l of inserted) {
    const i = fresh.find((x) => x.id === l.externalId)!;
    const read = await readItems(view, l.sources, map);
    const values = boardValues(provider, read.sources, {
      heading: null,
      itemUrl: (id) => itemUrl(origin, boardId, id),
    });
    await repo.markSynced(l.id, baseOf(values, i.values), []);
  }
  // The issues' links back to their cards are added by a sync each (they may take a while).
  await enqueueSync(inserted.map((l) => l.id));
  // A tracker that takes Freero's own webhooks (Asana, monday.com, ClickUp, Trello) is told about these projects.
  void ensureWebhooks(conn, fresh.map((i) => i.project), origin);
  await recordAudit({
    action: 'tracker.issues_imported',
    workspaceId: board.workspaceId,
    metadata: {
      provider: conn.provider,
      connection: conn.id,
      imported: inserted.length,
      skipped: issues.length - inserted.length,
    },
  });
  emitTrackerActivity({
    boardId,
    actorId: userId,
    action: 'tracker_imported',
    provider: conn.provider,
    issue: null,
    count: inserted.length,
  });
  return {
    created,
    skipped: issues.length - inserted.length,
    cards: inserted.map((l) => ({ id: l.sources[0], key: l.externalKey, url: l.externalUrl, linkId: l.id })),
    ...(containerId ? { containerId } : {}),
    ...(target ? { unscheduled } : {}),
  };
}

type ImportWhat = { query: string; scope?: undefined } | { query?: undefined; scope: { project: string; sprint: string | null; epic: string | null } };

/** What an import takes: a query in the tracker's language, or a project — its sprint / epic (#119, #43), or all of it (#120, #121). */
function importQuery(body: Record<string, unknown>): ImportWhat {
  if (body.scope !== undefined && body.scope !== null) {
    if (body.query !== undefined && body.query !== null && body.query !== '') throw badRequest('Give query or scope, not both');
    const s = body.scope as Record<string, unknown>;
    if (typeof s !== 'object' || typeof s.project !== 'string' || !s.project.trim() || s.project.length > 200) throw badRequest('scope.project must name a project');
    const opt = (v: unknown, what: string, max: number) => {
      if (v === undefined || v === null || v === '') return null;
      if (typeof v !== 'string' || v.length > max) throw badRequest(`${what} must be text (at most ${max} characters)`);
      return v.trim();
    };
    const sprint = opt(s.sprint, 'scope.sprint', 64);
    const epic = opt(s.epic, 'scope.epic', 2000);
    // Neither: the whole project (an Asana project, a monday.com board), up to the import's limit.
    return { scope: { project: s.project.trim(), sprint, epic } };
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 2000) throw badRequest('query is required (at most 2000 characters)');
  return { query };
}

/**
 * The issues an import asks for (a query, or a project's sprint / epic: 'current' is the active
 * sprint), and those of them not on this board yet through this connection; with a sprint, the
 * project's sprints too (the kanban's Sprint options).
 */
async function searchNew(
  userId: string,
  boardId: string,
  conn: StoredConnection,
  what: ImportWhat,
  limit: number,
): Promise<{ issues: RemoteIssue[]; fresh: RemoteIssue[]; sprints: TrackerSprint[] | null }> {
  await consumeRateLimit('trackerSend', userId);
  const provider = providerOf(conn.provider);
  const name = providerName(conn);
  let issues: RemoteIssue[];
  let sprints: TrackerSprint[] | null = null;
  try {
    const pc = openConnection(conn);
    if (what.scope) {
      const scope = { ...what.scope };
      if (!provider.scoped) throw new TrackerError(`${name} issues are imported with a query.`, 'invalid', 400);
      if (scope.sprint) {
        if (!provider.sprints) throw new TrackerError(`${name} has no sprints Freero can import.`, 'invalid', 400);
        sprints = await provider.sprints.list(pc, scope.project);
        const fieldName = provider.sprints.fieldName.toLowerCase();
        if (scope.sprint === 'current') {
          const active = sprints.find((s) => s.state === 'active');
          if (!active) throw new TrackerError(`No ${fieldName} is active in ${scope.project}.`, 'invalid', 400);
          scope.sprint = active.id;
        } else if (!sprints.some((s) => s.id === scope.sprint)) throw new TrackerError(`${scope.project} has no such ${fieldName}.`, 'invalid', 400);
      }
      issues = await provider.scoped(pc, scope, limit);
    } else issues = await provider.search(pc, what.query, limit);
    await noteOutcome(conn, null);
  } catch (e) {
    await noteOutcome(conn, e);
    if (e instanceof TrackerError) throw new HttpError(e.kind === 'invalid' ? 400 : 502, e.message, 'tracker_refused');
    throw e;
  }
  const already = await repo.linkedIssuesOnBoard(boardId, conn.id);
  return { issues, fresh: issues.filter((i) => !already.has(i.id)), sprints };
}

/**
 * What an import would bring, nothing written (an agent that may only suggest proposes these as
 * cards): the issues matching the query that aren't on this board yet, with the same access,
 * limit and dedupe rules as the import.
 */
export async function importCandidates(userId: string, boardId: string, body: Record<string, unknown>) {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(body.connectionId, board.workspaceId, userId);
  const what = importQuery(body);
  const limit = typeof body.limit === 'number' && Number.isInteger(body.limit) ? Math.max(1, Math.min(MAX_IMPORT, body.limit)) : 50;
  const { issues, fresh } = await searchNew(userId, boardId, conn, what, limit);
  return {
    skipped: issues.length - fresh.length,
    issues: fresh.map((i) => ({ id: i.id, key: i.key, url: i.url, title: i.values.title || i.key, description: i.values.description.slice(0, 5000), status: i.values.status ?? 'todo', dueDate: i.values.dueDate ?? null })),
  };
}

// ---- proposed imports (#82): accepted proposed cards become linked cards ----

/**
 * Notes which issue each card of a proposed import stands for: `importCandidates` found them and
 * the suggestions sink proposed them as the group `groupId` (cards under the ids they get when
 * accepted). Accepting one later links it (`proposalsDecided`, `linkAcceptedProposals`).
 */
export async function noteProposedImport(
  userId: string,
  boardId: string,
  p: { connectionId: string; groupId: string; origin: string; cards: Array<{ itemId: string; issueId: string; key: string; url: string }> },
): Promise<void> {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(p.connectionId, board.workspaceId, userId);
  await repo.insertProposals(
    p.cards.map((c) => ({
      boardId,
      itemId: c.itemId,
      groupId: p.groupId,
      connectionId: conn.id,
      externalId: c.issueId,
      externalKey: c.key,
      externalUrl: c.url,
      proposedBy: userId,
      appOrigin: p.origin,
    })),
  );
}

/**
 * Realtime's report of decisions applied (a socket's accept, the API's, an undo): the decisions on
 * proposed cards are recorded, and accepted ones queued to be linked — by the outbox consumer, so
 * a link is made once even when two instances report at once. Only the server's own proposal
 * records reach here (sockets can only decide them), and a card is matched by group and id.
 */
export async function proposalsDecided(e: SuggestionsDecidedEvent): Promise<void> {
  const creates = e.decisions.filter((d) => d.op === 'create' && d.itemId);
  if (!creates.length) return;
  await repo.transaction(async () => {
    let accepted = 0;
    for (const status of ['accepted', 'rejected', 'reopened'] as const) {
      const list = creates.filter((d) => d.status === status).map((d) => ({ groupId: d.groupId, itemId: d.itemId! }));
      if (!list.length) continue;
      const n = await repo.decideProposals(e.boardId, list, status === 'reopened' ? null : status, e.actorId);
      if (status === 'accepted') accepted += n;
    }
    if (accepted) await appendOutbox(TRACKER_SYNC_TOPIC, `proposals:${e.boardId}`);
  });
}

/**
 * Links the accepted proposed cards of a board to their issues (only the outbox consumer runs it).
 * Each card on the board as its proposer sees it becomes a link like an imported card's, through
 * the proposer's access to the connection ("GitHub for Maria" writes the tracker's changes). The
 * agreement it starts from is the card as accepted on BOTH sides, so the link's first sync brings
 * the issue's own values onto the card (its title without the key, labels as tags, assignee) and
 * pushes nothing; it also writes the badge and the issue's link back. A card not on the board yet
 * waits for the next saved change; one whose issue or item is linked otherwise, or whose proposer
 * can no longer edit the board or use the connection, stays a plain card. Returns the links to sync.
 */
async function linkAcceptedProposals(boardId: string): Promise<string[]> {
  const out: string[] = [];
  const imported = new Map<string, { conn: StoredConnection; workspaceId: string; actorId: string; n: number }>();
  for (const p of await repo.proposalsToLink(boardId)) {
    const conn = await repo.getConnection(p.connectionId);
    let board: Awaited<ReturnType<typeof requireBoardAccess>>;
    try {
      if (!conn) throw notFound('The connection is gone');
      board = await requireBoardAccess(boardId, p.proposedBy, 'editor');
      await requireUsable(conn.id, board.workspaceId, p.proposedBy);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await repo.dropProposal(boardId, p.itemId);
      continue;
    }
    const view = await readBoardView(boardId, { userId: p.proposedBy, role: board.role });
    const read = await readItems(view, [p.itemId]);
    if (!read.items.length) continue; // accepted, not on the board (yet): the next saved change retries
    const already = (await repo.linkedItems(boardId, [p.itemId])).get(p.itemId);
    if (already) {
      // Accepted again after an undo, before its old link noticed the card had gone: that link holds.
      const link = await repo.getLink(already);
      if (link?.connectionId === conn.id && link.externalId === p.externalId) {
        await repo.markProposalLinked(boardId, p.itemId);
        out.push(link.id);
      } else await repo.dropProposal(boardId, p.itemId);
      continue;
    }
    const provider = providerOf(conn.provider);
    const values = boardValues(provider, (await readItems(view, [p.itemId], fieldMapOf(conn))).sources, { heading: null, itemUrl: (id) => itemUrl(p.appOrigin, boardId, id) });

    const link: StoredLink = {
      id: newId(16),
      connectionId: conn.id,
      boardId,
      externalId: p.externalId,
      externalKey: p.externalKey,
      externalUrl: p.externalUrl,
      createdBy: p.proposedBy,
      appOrigin: p.appOrigin,
      base: baseOf(values, values),
      backlinks: [],
      state: 'ok',
      lastError: null,
      attempts: 0,
      retryAt: null,
      syncedAt: null,
      createdAt: Date.now(),
      sources: [p.itemId],
    };
    try {
      await repo.insertLink(link);
    } catch (e) {
      // The issue was imported here meanwhile (or the card linked otherwise): it stays a plain card.
      if (!(e instanceof repo.IssueAlreadyLinkedError || e instanceof repo.ItemAlreadyLinkedError)) throw e;
      await repo.dropProposal(boardId, p.itemId);
      continue;
    }
    await repo.markProposalLinked(boardId, p.itemId);
    out.push(link.id);
    const k = `${conn.id}\n${p.decidedBy ?? p.proposedBy}`;
    const seen = imported.get(k) ?? { conn, workspaceId: board.workspaceId, actorId: p.decidedBy ?? p.proposedBy, n: 0 };
    seen.n++;
    imported.set(k, seen);
  }
  for (const { conn, workspaceId, actorId, n } of imported.values())
    await recordAudit({
      action: 'tracker.issues_imported',
      workspaceId,
      actorId,
      metadata: { provider: conn.provider, connection: conn.id, imported: n, skipped: 0, via: 'suggestion' },
    });
  return out;
}

/** The kanban a placement puts cards into (as the structure module reads it), 'new' for `newKanban`, else null. */
function kanbanTargetOf(view: BoardView, p: NonNullable<ReturnType<typeof readPlacement>>): { k: KanbanElement; column?: string } | 'new' | null {
  if (p.newKanban !== undefined && p.newKanban !== null) return 'new';
  if (p.into === undefined || p.into === null) return null;
  const into = String(p.into);
  const byId = (id: string) => view.elements.find((e) => e.el.id === id)?.el;
  const ref = /^([^:]+):(.+)$/.exec(into);
  const asColumn = !into.startsWith('cluster:') && ref && byId(ref[1])?.type === 'kanban';
  const el = asColumn ? byId(ref![1]) : byId(into);
  if (el?.type !== 'kanban') return null;
  const column = p.column !== undefined && p.column !== null ? String(p.column) : asColumn ? ref![2] : undefined;
  return { k: el as KanbanElement, ...(column !== undefined ? { column } : {}) };
}

/** One card at (0, 0): checks a placement against the board before anything is imported. */
function probeLaid(): LaidOut {
  const id = 'probe';
  return {
    elements: [{ id, type: 'card', x: 0, y: 0, w: CARD_W, h: 100, rotation: 0, title: '', description: '', color: '#5B3FF0', status: 'todo', assigneeId: null, dueDate: null, tags: [] } as ElementDraft],
    content: {},
    moves: [],
    size: { w: CARD_W, h: 100 },
    parts: [{ ids: [id] }],
  };
}

const GROUPS = new Set<RoadmapGroupBy>(['none', 'team', 'epic', 'label', 'quarter']);

/** A roadmap import's target from a request body (`timeline: { id, groupBy? }`), or null. */
function roadmapTarget(v: unknown): { id: string; groupBy: RoadmapGroupBy } | null {
  if (v === undefined || v === null) return null;
  const t = v as { id?: unknown; groupBy?: unknown };
  if (typeof t.id !== 'string' || !t.id || t.id.length > 64) throw badRequest('timeline.id must name a timeline');
  if (t.groupBy !== undefined && !GROUPS.has(t.groupBy as RoadmapGroupBy)) throw badRequest('timeline.groupBy must be none, team, epic, label or quarter', 'tracker_group_by_invalid');
  return { id: t.id, groupBy: (t.groupBy as RoadmapGroupBy | undefined) ?? 'none' };
}

async function requireLinkOnBoard(userId: string, boardId: string, linkId: string) {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const link = await repo.getLink(linkId);
  if (!link || link.boardId !== boardId) throw notFound('No such linked issue on this board');
  return { board, link };
}

/** Stops syncing an issue: the items lose their badge, the issue its links back; both stay. */
export async function unlink(userId: string, boardId: string, linkId: string): Promise<void> {
  const { board, link } = await requireLinkOnBoard(userId, boardId, linkId);
  const conn = await repo.getConnection(link.connectionId);
  await repo.deleteLink(link.id);
  if (conn?.credentialsSealed) {
    const pc = openConnection(conn);
    const provider = providerOf(conn.provider);
    try {
      const issue = await provider.getIssue(pc, link.externalId);
      if (issue) await provider.setBacklinks(pc, issue, [], link.backlinks);
    } catch {
      /* best effort: the issue keeps a link that now leads to a plain item */
    }
  }
  const user = await getUser(userId);
  await writeBoard(boardId, { userId, role: board.role, name: user?.name }, (live) => ({
    update: live.elements.filter((e) => e.el.trackerLink === link.id).map((e) => ({ id: e.el.id, patch: { trackerLink: null } })),
    collections: { [TRACKER_COLLECTION]: { [link.id]: null } },
  }));
  await recordAudit({
    action: 'tracker.unlinked',
    workspaceId: board.workspaceId,
    target: { type: 'tracker_issue', id: link.id, label: link.externalKey },
    metadata: { provider: conn?.provider ?? null, reason: 'unlinked' },
  });
  if (conn)
    emitTrackerActivity({
      boardId,
      actorId: userId,
      action: 'tracker_unlinked',
      provider: conn.provider,
      issue: link.externalKey,
    });
}

/** "Sync now": queues the link (the consumer runs it). */
export async function requestSync(userId: string, boardId: string, linkId: string): Promise<void> {
  const { link } = await requireLinkOnBoard(userId, boardId, linkId);
  await enqueueSync([link.id]);
}

const movedNote = (link: Pick<StoredLink, 'externalKey'>, conn: Pick<StoredConnection, 'name'>) =>
  `This board moved to another workspace, so ${link.externalKey} no longer syncs through ${conn.name}.`;

/**
 * A board moved into another workspace (#124): issues linked through a TEAM connection of another
 * workspace stop syncing — that team's tracker must not keep receiving a board it no longer holds,
 * nor write into it (syncLink refuses them too, whatever path queues them). Their badges say why;
 * the items and the issues stay as they are. A person's own connections go with them. Returns how
 * many it paused.
 */
export async function pauseLinksOutside(boardId: string, workspaceId: string): Promise<number> {
  const paused: Array<{ link: StoredLink; conn: StoredConnection }> = [];
  for (const link of await repo.linksOfBoard(boardId)) {
    const conn = await repo.getConnection(link.connectionId);
    if (!conn?.workspaceId || conn.workspaceId === workspaceId) continue;
    await repo.markFailed(link.id, 'paused', movedNote(link, conn), null);
    paused.push({ link, conn });
  }
  for (const { link, conn } of paused) {
    const who = await actorFor(link, conn);
    if (who === 'gone' || who === 'no_access') continue;
    await writeBoard(boardId, who.actor, (view) => {
      const prev = view.collection(TRACKER_COLLECTION).get(link.id) as TrackerIssueRecord | undefined;
      return prev ? { collections: { [TRACKER_COLLECTION]: { [link.id]: { ...prev, state: 'paused', note: movedNote(link, conn), syncedAt: Date.now() } } } } : null;
    });
  }
  return paused.length;
}

/**
 * After a connection was removed: its badges say so, board items stay exactly as they are. Written
 * as each link's person where they can still edit the board.
 */
export async function markDisconnected(conn: StoredConnection, links: Array<{ boardId: string; linkId: string; createdBy: string }>): Promise<void> {
  const byBoard = new Map<string, Array<{ linkId: string; createdBy: string }>>();
  for (const l of links) byBoard.set(l.boardId, [...(byBoard.get(l.boardId) ?? []), l]);
  for (const [boardId, list] of byBoard) {
    const ids = list.map((l) => l.linkId);
    try {
      // Written as someone who linked an issue here and can still edit the board.
      let writer: { userId: string; role: BoardActor['role'] } | null = null;
      for (const l of list) {
        const board = await requireBoardAccess(boardId, l.createdBy, 'editor').catch(() => null);
        if (board) {
          writer = { userId: l.createdBy, role: board.role };
          break;
        }
      }
      if (!writer) continue;
      await writeBoard(boardId, writer, (live) => {
        const recs = live.collection(TRACKER_COLLECTION);
        const out: Record<string, unknown> = {};
        for (const id of ids) {
          const prev = recs.get(id) as TrackerIssueRecord | undefined;
          if (prev)
            out[id] = {
              ...prev,
              state: 'disconnected',
              note: `${conn.name} was disconnected: this issue no longer syncs.`,
              syncedAt: Date.now(),
            };
        }
        return Object.keys(out).length ? { collections: { [TRACKER_COLLECTION]: out } } : null;
      });
    } catch (e) {
      log(`trackers: couldn’t mark the badges on board ${boardId} as disconnected (${e instanceof Error ? e.message : 'error'})`);
    }
  }
}

/** Connections usable on a board, for the board's menus. */
export async function boardConnections(userId: string, boardId: string) {
  const board = await requireBoardAccess(boardId, userId, 'viewer');
  if (board.role !== 'owner' && board.role !== 'editor') return [];
  return (await usableConnections(board.workspaceId, userId)).map((c) => ({
    id: c.id,
    provider: c.provider,
    name: c.name,
    scope: c.ownerId ? ('personal' as const) : ('workspace' as const),
    site: c.site,
    defaults: {
      project: c.settings.project ?? null,
      issueType: c.settings.issueType ?? null,
    },
    status: c.status,
  }));
}

/** Projects (Jira), teams (Linear) or repositories (GitHub) of a connection the person may use. */
export async function projectsOf(userId: string, connectionId: string, boardId: string) {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(connectionId, board.workspaceId, userId);
  try {
    const projects = await providerOf(conn.provider).listProjects(openConnection(conn));
    await noteOutcome(conn, null);
    return { projects, queryLanguage: providerOf(conn.provider).queryLanguage };
  } catch (e) {
    await noteOutcome(conn, e);
    if (e instanceof TrackerError) throw new HttpError(502, e.message, 'tracker_refused');
    throw e;
  }
}

/** Runs a read of the tracker for a board menu, in Freero's words when the tracker refuses. */
async function askTracker<T>(conn: StoredConnection, fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    await noteOutcome(conn, null);
    return out;
  } catch (e) {
    await noteOutcome(conn, e);
    if (e instanceof TrackerError) throw new HttpError(e.kind === 'invalid' ? 400 : 502, e.message, 'tracker_refused');
    throw e;
  }
}

const projectParam = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > 200) throw badRequest('project is required');
  return v.trim();
};

/** A project's sprints / cycles / iterations (#119), for the import dialog's picker. */
export async function sprintsOf(userId: string, connectionId: string, boardId: string, project: unknown): Promise<{ sprints: TrackerSprint[]; fieldName: string | null }> {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(connectionId, board.workspaceId, userId);
  const provider = providerOf(conn.provider);
  if (!provider.sprints) return { sprints: [], fieldName: null };
  const key = projectParam(project);
  return { sprints: await askTracker(conn, () => provider.sprints!.list(openConnection(conn), key)), fieldName: provider.sprints.fieldName };
}

/** The issue types a project can create (#43), for the send dialog's picker. */
export async function issueTypesOf(userId: string, connectionId: string, boardId: string, project: unknown): Promise<{ issueTypes: string[]; preferred: string | null }> {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(connectionId, board.workspaceId, userId);
  const provider = providerOf(conn.provider);
  const key = projectParam(project);
  const preferred = conn.settings.issueTypes?.[key] ?? conn.settings.issueType ?? null;
  if (!provider.issueTypes) return { issueTypes: [], preferred };
  return { issueTypes: await askTracker(conn, () => provider.issueTypes!(openConnection(conn), key)), preferred };
}

/** Every link of a connection is queued again (its credentials were fixed). */
export async function resyncConnection(connectionId: string): Promise<void> {
  await enqueueSync((await repo.linksOfConnection(connectionId)).map((l) => l.id));
}
