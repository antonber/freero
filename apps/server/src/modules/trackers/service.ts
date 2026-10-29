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
  canonical,
  ISSUE_FIELD_LABELS,
  ISSUE_FIELDS,
  mergeField,
  pullableFields,
  TRACKER_COLLECTION,
  TRACKER_PROVIDERS,
  type BoardElement,
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
  estimateNumber,
  LayoutError,
  translateDraft,
  type ActingApp,
  type ElementDraft,
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
import { BOARD_CONTENT_TOPIC, BoardChangeError, changeBoard, readBoardView, storedBoardView, type BoardActor, type BoardChange, type BoardView } from '../realtime/index';
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
import { emitTrackerActivity } from './events';
import { dayNumber } from './board';
import { planRoadmapImport } from './roadmap';
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

const assigneesIn = (els: BoardElement[]) =>
  els.flatMap((el) => (el.type === 'card' && typeof (el as { assigneeId?: unknown }).assigneeId === 'string' ? [(el as { assigneeId: string }).assigneeId] : []));

/** The link's items as the mapping reads them, from a board view. */
async function readItems(view: Pick<BoardView, 'elements' | 'collection'>, ids: string[]) {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const items = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const missing = ids.filter((id) => !byId.has(id));
  const emails = await emailsOf(assigneesIn(items));
  const tags = tagsWith(view, {});
  const sources = items.map((el) => sourceOf(el, tags, (id) => emails.get(id) ?? null));
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
  if (conn.status === 'needs_auth' || !conn.credentialsSealed) {
    await failLink(link, conn, new TrackerError(`${conn.name} needs to be connected again.`, 'auth'), who);
    return null;
  }
  const provider = providerOf(conn.provider);
  const pc = openConnection(conn);
  try {
    const view = await readBoardView(link.boardId, who.actor);
    const read = await readItems(view, link.sources);

    let issue = await provider.getIssue(pc, link.externalId);
    if (!issue) throw new TrackerError(`${link.externalKey} no longer exists in ${providerName(conn)} (or this connection can’t see it).`, 'not_found', 404);

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
    const pullable = pullableFields(read.sources);
    const merges = ISSUE_FIELDS.filter((f) => provider.fields.includes(f)).map((f) =>
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
        `${ISSUE_FIELD_LABELS[f]} of ${issue.key} changed here and in ${providerName(conn)} since the last sync. ${providerName(conn)}’s value was kept${
          f === 'description' || !lost ? '' : `; the board had “${lost.replace(/\n/g, ', ').slice(0, 200)}”`
        }.`,
      );
    }

    if (pushed.length) {
      const patch: IssueValues = {};
      for (const f of pushed) (patch as Record<string, unknown>)[f] = board[f];
      notes.push(...(await provider.updateIssue(pc, issue, patch)));
      issue = (await provider.getIssue(pc, link.externalId)) ?? issue;
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

    // The tracker's side onto the board, plus the badge and notes, in one change.
    const pull: IssueValues = {};
    for (const f of pulled) (pull as Record<string, unknown>)[f] = issue.values[f];
    const userIdOf = new Map<string, string>();
    if (typeof pull.assignee === 'string' && !pull.assignee.startsWith('~')) {
      const id = await boardUserByEmail(link.boardId, pull.assignee);
      if (id) userIdOf.set(pull.assignee, id);
    }
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
      });
      notes.push(...plan.notes);
      const after = applied(liveItems, plan);
      const emails = new Map(read.emails);
      for (const [e, id] of userIdOf) emails.set(id, e);
      const tags = tagsWith(live, plan.tags);
      boardAfter = boardValues(
        provider,
        after.map((el) => sourceOf(el, tags, (id) => emails.get(id) ?? null)),
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
      if (!update.length && !Object.keys(collections).length) return null;
      return { update, collections };
    });

    const base: SyncBase = baseOf(boardAfter, finalIssue.values);
    await repo.markSynced(link.id, base, present);
    await noteOutcome(conn, null);

    if (pushed.length || pulled.length || conflicts.length) {
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
        },
      });
      if (pushed.length)
        emitTrackerActivity({
          boardId: link.boardId,
          actorId: link.createdBy,
          action: 'tracker_synced',
          provider: conn.provider,
          issue: link.externalKey,
          fields: pushed.map((f) => ISSUE_FIELD_LABELS[f].toLowerCase()),
        });
    }
    return { pushed, pulled, conflicts, notes };
  } catch (e) {
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
  const read = await readItems(view, link.sources);
  if (read.missing.length) return true;
  const provider = providerOf(conn.provider);
  const board = boardValues(provider, read.sources, {
    heading: read.heading,
    itemUrl: (id) => itemUrl(link.appOrigin, link.boardId, id),
  });
  return ISSUE_FIELDS.some((f) => {
    const now = canonical(f, board);
    return now !== undefined && link.base.board[f] !== undefined && now !== link.base.board[f];
  });
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
    for (const e of events) {
      if (e.key.startsWith('link:')) toSync.add(e.key.slice('link:'.length));
      else if (e.topic === BOARD_CONTENT_TOPIC && e.key.startsWith('board:')) {
        const boardId = e.key.slice('board:'.length);
        if (!(await repo.boardHasLinks(boardId))) continue;
        const view = await storedBoardView(boardId);
        for (const link of await repo.linksOfBoard(boardId)) {
          const conn = await repo.getConnection(link.connectionId);
          if (conn && (await boardSideChanged(link, conn, view))) toSync.add(link.id);
        }
      }
    }
    for (const id of toSync) await syncLink(id);
  },
};

// ---- polling and retries (exclusive job) ----

/** Queues links whose retry is due and polls connections that are due; returns how many were queued. */
export async function pollOnce(now = Date.now()): Promise<number> {
  const cfg = getConfig().trackers;
  const queued = new Set(await repo.claimRetries(now));
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
 * misconfigured secret shows up in the tracker's delivery log.
 */
export async function receiveWebhook(connectionId: string, req: Request): Promise<{ queued: number }> {
  const conn = await repo.getConnection(connectionId);
  if (!conn) throw notFound('No such tracker connection');
  const secret = webhookSecretOf(conn);
  const body = rawBody(req);
  if (!secret || !body) throw new HttpError(401, 'The webhook could not be verified');
  const delivery = providerOf(conn.provider).webhook({
    headers: req.headers,
    rawBody: body,
    secret,
    now: Date.now(),
  });
  if (!delivery) throw new HttpError(401, 'The webhook could not be verified');
  const links = await repo.linksToIssues(conn.id, delivery.issues);
  await enqueueSync(links.map((l) => l.id));
  return { queued: links.length };
}

// ---- send, preview, import, unlink ----

function itemIdsOf(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw badRequest('itemIds must list the items to send');
  if (v.length > MAX_ITEMS_PER_SEND) throw badRequest(`At most ${MAX_ITEMS_PER_SEND} items at once`);
  const ids = [...new Set(v.map((x) => (typeof x === 'string' ? x : '')))];
  if (ids.some((id) => !id || id.length > 64)) throw badRequest('itemIds must be item ids');
  return ids;
}

async function sendContext(userId: string, boardId: string, body: Record<string, unknown>) {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(body.connectionId, board.workspaceId, userId);
  const ids = itemIdsOf(body.itemIds);
  const view = await readBoardView(boardId, { userId, role: board.role });
  const read = await readItems(view, ids);
  if (read.missing.length) throw notFound(read.missing.length === 1 ? 'That item isn’t on this board any more' : 'Some of those items aren’t on this board any more');
  const odd = read.items.find((el) => !SENDABLE_TYPES.has(el.type));
  if (odd) throw badRequest(`A ${odd.type} can’t become part of an issue: send sticky notes, cards, shapes or text`);
  const mode = body.mode === 'each' ? 'each' : 'one';
  const groups = mode === 'each' ? read.items.map((el) => [el]) : [read.items];
  return { board, conn, view, read, groups };
}

function groupValues(provider: TrackerProvider, view: BoardView, read: Awaited<ReturnType<typeof readItems>>, group: BoardElement[], origin: string, boardId: string) {
  const sources = group.map((el) => read.sources.find((s) => s.id === el.id)!);
  const heading = group.length > 1 ? clusterHeading(view, group) : null;
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
  const { conn, view, read, groups } = await sendContext(userId, boardId, body);
  const provider = providerOf(conn.provider);
  return groups.map((group) => {
    const { sources, values } = groupValues(provider, view, read, group, origin, boardId);
    const unmapped = unmappedOf(provider, sources);
    for (const el of group) {
      const est = (el as { estimate?: unknown }).estimate;
      if (el.type === 'card' && typeof est === 'string' && est.trim() && estimateNumber(est) === null) unmapped.push(`Estimate “${est.slice(0, 20)}” (not a number)`);
    }
    return { itemIds: group.map((el) => el.id), values, unmapped };
  });
}

/**
 * Creates one issue for the items (or one per item) and links them: the badge on every item, the
 * issue's links back to each of them. The board side is ONE change, attributed to the tracker
 * for the person; nothing on the board changes when the tracker refuses.
 */
export async function sendToTracker(userId: string, boardId: string, body: Record<string, unknown>, origin: string): Promise<TrackerSendResponse> {
  const ctx = await sendContext(userId, boardId, body);
  const { conn, view, read, groups, board } = ctx;
  const linked = await repo.linkedItems(
    boardId,
    read.items.map((el) => el.id),
  );
  if (linked.size) throw new HttpError(409, `${linked.size === 1 ? 'That item is' : `${linked.size} of those items are`} already linked to an issue`, 'tracker_already_linked');
  const project = typeof body.project === 'string' && body.project.trim() ? body.project.trim().slice(0, 200) : (conn.settings.project ?? null);
  if (!project) throw badRequest('project is required');
  const issueType = typeof body.issueType === 'string' && body.issueType.trim() ? body.issueType.trim().slice(0, 100) : (conn.settings.issueType ?? null);
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
  for (const group of groups) {
    try {
      const { values } = groupValues(provider, view, read, group, origin, boardId);
      const { issue, notes } = await provider.createIssue(pc, {
        project,
        issueType,
        values,
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
    throw new HttpError(
      failure instanceof TrackerError && failure.kind === 'invalid' ? 400 : 502,
      made.length ? `Created ${made.map((m) => m.link.externalKey).join(', ')}; then: ${what}` : what,
      'tracker_refused',
    );
  }
  return {
    issues: made.map((m) => ({
      linkId: m.link.id,
      key: m.link.externalKey,
      url: m.link.externalUrl,
      itemIds: m.link.sources,
    })),
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
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 2000) throw badRequest('query is required (at most 2000 characters)');
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
  const { issues, fresh } = await searchNew(userId, boardId, conn, query, limit);
  if (!fresh.length) return { created: [], skipped: issues.length, cards: [] };

  // People and tags the cards need, resolved before the board is written.
  const assignee = new Map<string, string | null>();
  for (const i of fresh) {
    const a = i.values.assignee;
    if (a && !a.startsWith('~') && !assignee.has(a)) assignee.set(a, await boardUserByEmail(boardId, a));
  }
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
        const placed = placeLaid(laid, placement, live, { newId: () => newId(10), obstacles, travelling: new Set(), keepStatus: true });
        containerId = placed.containerId;
        return { create: placed.elements, update: placed.grow, collections };
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
    const read = await readItems(view, l.sources);
    const values = boardValues(provider, read.sources, {
      heading: null,
      itemUrl: (id) => itemUrl(origin, boardId, id),
    });
    await repo.markSynced(l.id, baseOf(values, i.values), []);
  }
  // The issues' links back to their cards are added by a sync each (they may take a while).
  await enqueueSync(inserted.map((l) => l.id));
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

/** The issues matching `query`, and those of them not on this board yet through this connection. */
async function searchNew(userId: string, boardId: string, conn: StoredConnection, query: string, limit: number): Promise<{ issues: RemoteIssue[]; fresh: RemoteIssue[] }> {
  await consumeRateLimit('trackerSend', userId);
  let issues: RemoteIssue[];
  try {
    issues = await providerOf(conn.provider).search(openConnection(conn), query, limit);
    await noteOutcome(conn, null);
  } catch (e) {
    await noteOutcome(conn, e);
    if (e instanceof TrackerError) throw new HttpError(e.kind === 'invalid' ? 400 : 502, e.message, 'tracker_refused');
    throw e;
  }
  const already = await repo.linkedIssuesOnBoard(boardId, conn.id);
  return { issues, fresh: issues.filter((i) => !already.has(i.id)) };
}

/**
 * What an import would bring, nothing written (an agent that may only suggest proposes these as
 * cards): the issues matching the query that aren't on this board yet, with the same access,
 * limit and dedupe rules as the import.
 */
export async function importCandidates(userId: string, boardId: string, body: Record<string, unknown>) {
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const conn = await requireUsable(body.connectionId, board.workspaceId, userId);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 2000) throw badRequest('query is required (at most 2000 characters)');
  const limit = typeof body.limit === 'number' && Number.isInteger(body.limit) ? Math.max(1, Math.min(MAX_IMPORT, body.limit)) : 50;
  const { issues, fresh } = await searchNew(userId, boardId, conn, query, limit);
  return {
    skipped: issues.length - fresh.length,
    issues: fresh.map((i) => ({ key: i.key, url: i.url, title: i.values.title || i.key, description: i.values.description.slice(0, 5000), status: i.values.status ?? 'todo', dueDate: i.values.dueDate ?? null })),
  };
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

const GROUPS = new Set<RoadmapGroupBy>(['none', 'team', 'epic', 'label']);

/** A roadmap import's target from a request body (`timeline: { id, groupBy? }`), or null. */
function roadmapTarget(v: unknown): { id: string; groupBy: RoadmapGroupBy } | null {
  if (v === undefined || v === null) return null;
  const t = v as { id?: unknown; groupBy?: unknown };
  if (typeof t.id !== 'string' || !t.id || t.id.length > 64) throw badRequest('timeline.id must name a timeline');
  if (t.groupBy !== undefined && !GROUPS.has(t.groupBy as RoadmapGroupBy)) throw badRequest('timeline.groupBy must be none, team, epic or label');
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

/** Every link of a connection is queued again (its credentials were fixed). */
export async function resyncConnection(connectionId: string): Promise<void> {
  await enqueueSync((await repo.linksOfConnection(connectionId)).map((l) => l.id));
}
