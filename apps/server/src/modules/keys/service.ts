// Workspace encryption keys (#159; docs/design/compliance.md §3). The envelope:
//   KEK (the instance's, or the workspace's AWS KMS key) wraps versioned DEKs (workspace_data_keys);
//   a DEK seals board content (realtime's blobs) with AES-256-GCM, bound by additional data to the
//   workspace, board, table and layer it belongs to (envelope.ts).
//
// Who asks what:
// - realtime seals every blob it writes for a board of a keyed workspace (`sealerFor`) and opens
//   every sealed blob it reads (`openSealed`); a sealed blob never falls back to anything;
// - workspaces' one `blocked` rule asks `unusableKeysAmong`, so REST, lists, search and socket
//   admission refuse a workspace whose key isn't active (`key_unavailable`).
//
// Caches (per instance, `WORKSPACE_KEY_CACHE_SECONDS`): unwrapped DEKs, and each workspace's key
// row. A state change here invalidates the key rows on every instance (pubsub) at once, so OPENING
// stops everywhere immediately; a DEK already in memory may still SEAL until it expires (an open
// room saving its last edits as it closes) — sealing never exposes anything. A key revoked at the
// KMS is noticed by the `keys:check` probe or the next unwrap, whichever comes first.
import type { WorkspaceKeyProvider, WorkspaceKeyStatus } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { log, logError } from '../../platform/log';
import { appendOutbox } from '../../platform/outbox';
import { publish, subscribe } from '../../platform/pubsub';
import { requireAdmin } from '../admin/index';
import { recordAudit } from '../audit/index';
import { boardIdsInWorkspace, boardWorkspacesAfter, underLegalHoldUntilCommit } from '../boards/index';
import { BOARD_CONTENT_TOPIC, boardsNeedingReseal, boardsSealedForAnotherWorkspace, resealBoard } from '../realtime/index';
import { refreshWorkspaceBoards, requireWorkspace } from '../workspaces/index';
import { newDataKey, openBlob, sealBlob } from './envelope';
import { KeyRefusedError, kekRefOf, KMS_PROVIDERS, KmsUnreachableError, parseKmsKeyId, unwrapDataKey, wrapDataKey, type KekRef } from './kek';
import * as repo from './repo';

export const KEY_UNAVAILABLE = 'workspace_key_unavailable';
/** Board content of a workspace whose key can't be used right now (suspended, destroyed, refused or unreachable at its KMS). */
export class KeyUnavailableError extends HttpError {
  constructor(public workspaceId: string, detail?: string) {
    super(403, `This workspace’s encryption key isn’t available${detail ? ` (${detail})` : ''}, so its boards can’t be opened`, KEY_UNAVAILABLE);
  }
}

const CHANNEL = 'freero:keys';

// ---- caches ----

const deks = new Map<string, { dek: Buffer; until: number }>();
const keyRows = new Map<string, { key: repo.KeyRow | null; until: number }>();
const cacheMs = () => getConfig().workspaceKeys.cacheMs;

/**
 * Whether board content may need sealing or opening at all. With WORKSPACE_KEYS on: always (look
 * each workspace up). Off (the default): no workspace can turn a key on, so "no workspace ever had
 * a key" — a server that never turned the feature on — stays true: board reads, writes and access
 * checks then skip every key lookup, and nothing is sealed. Keys turned on earlier, while it was on,
 * keep working (destroyed ones keep their content closed).
 */
let inUse: { value: boolean; until: number } | null = null;
export async function keysInUse(): Promise<boolean> {
  if (getConfig().workspaceKeys.enabled) return true;
  if (inUse && inUse.until > Date.now()) return inUse.value;
  const value = await repo.anyKeyInUse();
  inUse = { value, until: Date.now() + cacheMs() };
  return value;
}

/** Forgets this workspace's key row here; `dropKeys`: its unwrapped data keys too. */
function forgetLocally(workspaceId: string, dropKeys: boolean): void {
  keyRows.delete(workspaceId);
  if (dropKeys) for (const k of [...deks.keys()]) if (k.startsWith(`${workspaceId}:`)) deks.delete(k);
}

function forgetEverywhere(workspaceId: string, dropKeys: boolean): void {
  forgetLocally(workspaceId, dropKeys);
  publish(CHANNEL, new TextEncoder().encode(JSON.stringify({ workspaceId, dropKeys })));
}

/** Listens for other instances' state changes (init.ts). */
export function listenForKeyChanges(): () => void {
  const sub = subscribe(CHANNEL, {
    message(data) {
      try {
        const m = JSON.parse(new TextDecoder().decode(data)) as { workspaceId?: unknown; dropKeys?: unknown };
        if (typeof m.workspaceId === 'string') forgetLocally(m.workspaceId, m.dropKeys === true);
      } catch {
        // not ours
      }
    },
    // Messages may have been missed: start over from the database.
    resubscribed: () => keyRows.clear(),
  });
  return () => sub.close();
}

/** Test hook: an instance that just started (nothing cached). */
export function forgetAllCachedKeys(): void {
  deks.clear();
  keyRows.clear();
  inUse = null;
}

async function keyOf(workspaceId: string): Promise<repo.KeyRow | null> {
  if (!(await keysInUse())) return null;
  const hit = keyRows.get(workspaceId);
  if (hit && hit.until > Date.now()) return hit.key;
  const key = await repo.getKey(workspaceId);
  keyRows.set(workspaceId, { key, until: Date.now() + cacheMs() });
  return key;
}

const kekOf = (k: { provider: WorkspaceKeyProvider; kmsKeyId: string | null }): KekRef => ({ provider: k.provider, kmsKeyId: k.kmsKeyId });

/**
 * Unwraps one data key (cached); a refusal by the KMS makes the key unavailable. `key` may be a
 * cached row from before a rotation on another instance changed the KEK: the refusal then changes
 * nothing (the state change is conditional on what was tried still being stored), and the unwrap is
 * tried once more with the key as stored now.
 */
async function dataKeyOf(key: repo.KeyRow, version: number, retried = false): Promise<Buffer> {
  const id = `${key.workspaceId}:${version}`;
  const hit = deks.get(id);
  if (hit && hit.until > Date.now()) return hit.dek;
  const row = await repo.dataKey(key.workspaceId, version);
  if (!row) throw new KeyUnavailableError(key.workspaceId, 'its data key is gone');
  let dek: Buffer;
  try {
    const out = await unwrapDataKey(kekOf(key), key.workspaceId, row.wrapped);
    dek = out.dek;
    // Made under a previous SESSION_SECRET: wrap it again under the current one (instance KEK rotation).
    if (out.stale) void wrapDataKey(kekOf(key), key.workspaceId, dek).then((w) => repo.rewrap(key.workspaceId, version, row.wrapped, w, row.kekRef)).catch(() => {});
  } catch (e) {
    if (e instanceof KeyRefusedError) {
      const marked = await markUnavailable(key.workspaceId, e.message, { ...kekOf(key), dataKey: { version, wrapped: row.wrapped } }).catch((err) => {
        logError('keys: could not record an unusable key', err);
        return true;
      });
      if (!marked && !retried) {
        forgetLocally(key.workspaceId, false);
        const now = await keyOf(key.workspaceId);
        if (now && now.state === 'active') return dataKeyOf(now, version, true);
      }
      throw new KeyUnavailableError(key.workspaceId, 'its key management service refused it');
    }
    if (e instanceof KmsUnreachableError) throw new KeyUnavailableError(key.workspaceId, 'its key management service could not be reached');
    throw e;
  }
  deks.set(id, { dek, until: Date.now() + cacheMs() });
  return dek;
}

/**
 * SESSION_SECRET rotation (docs/operations.md): every data key wrapped by the instance's key under a
 * secret listed in SESSION_SECRET_PREVIOUS is wrapped again under the current one — whether or not
 * its workspace is used meanwhile — so removing the previous secret never leaves one unreadable.
 * `unreadable`: wrapped under a secret no longer configured (lost unless that secret comes back).
 * Idempotent; a row changed meanwhile (a rotation, another instance) is left to the next run.
 */
export async function rewrapInstanceKeys(): Promise<{ rewrapped: number; unreadable: number }> {
  let rewrapped = 0;
  let unreadable = 0;
  for (const row of await repo.instanceWrappedDataKeys()) {
    let out: { dek: Buffer; stale: boolean };
    try {
      out = await unwrapDataKey({ provider: 'instance', kmsKeyId: null }, row.workspaceId, row.wrapped);
    } catch {
      unreadable++;
      continue;
    }
    if (!out.stale) continue;
    const again = await wrapDataKey({ provider: 'instance', kmsKeyId: null }, row.workspaceId, out.dek);
    if (await repo.rewrap(row.workspaceId, row.version, row.wrapped, again, row.kekRef)) rewrapped++;
  }
  return { rewrapped, unreadable };
}

// ---- what realtime uses ----

export interface BlobSealer {
  /** `<workspaceId>:<dataKeyVersion>`, stored next to each blob it seals. */
  ref: string;
  seal(aad: string, plain: Uint8Array): Buffer;
}

/**
 * How to seal new content of this workspace: null when it has no key (content is stored as is).
 * Throws KeyUnavailableError when it has one that can't be used — the caller must then not write
 * at all, never write in the clear.
 */
export async function sealerFor(workspaceId: string): Promise<BlobSealer | null> {
  const key = await keyOf(workspaceId);
  if (!key) return null;
  const cached = deks.get(`${workspaceId}:${key.currentVersion}`);
  let dek: Buffer;
  if (cached) dek = cached.dek; // still in memory: sealing with it exposes nothing, whatever the state now
  else if (key.state !== 'active') throw new KeyUnavailableError(workspaceId);
  else dek = await dataKeyOf(key, key.currentVersion);
  return { ref: `${workspaceId}:${key.currentVersion}`, seal: (aad, plain) => sealBlob(dek, aad, plain) };
}

/**
 * How to open blobs sealed under `ref`: checked once (the key is active, its data key unwraps), then
 * each blob opens without another lookup — for many blobs under one ref (a file's chunks). Throws
 * KeyUnavailableError when the key can't be used; `open` throws it for a blob that doesn't belong
 * where it was found (another board's, workspace's or file's) or was altered.
 */
export async function openerFor(ref: string): Promise<(aad: string, data: Uint8Array) => Buffer> {
  const at = ref.lastIndexOf(':');
  const workspaceId = ref.slice(0, at);
  const version = Number(ref.slice(at + 1));
  if (at <= 0 || !Number.isInteger(version)) throw new KeyUnavailableError(workspaceId || 'unknown', 'unreadable key reference');
  const key = await keyOf(workspaceId);
  if (!key || key.state !== 'active') throw new KeyUnavailableError(workspaceId);
  const dek = await dataKeyOf(key, version);
  return (aad, data) => {
    try {
      return openBlob(dek, aad, data);
    } catch {
      // Not this board's / workspace's / table's / file's blob, or altered: never readable.
      throw new KeyUnavailableError(workspaceId, 'a stored blob does not belong where it was found');
    }
  };
}

/** Opens a blob sealed under `ref`. Throws KeyUnavailableError unless the key is active and opens it. */
export async function openSealed(ref: string, aad: string, data: Uint8Array): Promise<Buffer> {
  return (await openerFor(ref))(aad, data);
}

/** The data-key reference new content of the workspace is sealed with, or null (no key / not active). */
export async function currentSealRef(workspaceId: string): Promise<string | null> {
  const key = await keyOf(workspaceId);
  return key && key.state === 'active' ? `${workspaceId}:${key.currentVersion}` : null;
}

/** The workspaces among these whose key exists but can't be used (the `key_unavailable` block). Always from the database. */
export async function unusableKeysAmong(workspaceIds: string[]): Promise<Set<string>> {
  if (!(await keysInUse())) return new Set();
  const states = await repo.statesOf(workspaceIds);
  return new Set([...states].filter(([, s]) => s !== 'active').map(([id]) => id));
}

/**
 * Every workspace with a key (from the database): the data-key reference each active one seals new
 * content with, and the ones whose key can't seal now (suspended, unavailable, destroyed). For jobs
 * that seal stored things again (uploads' files).
 */
export async function keyedWorkspaces(): Promise<{ sealing: Map<string, string>; unusable: string[] }> {
  if (!(await keysInUse())) return { sealing: new Map(), unusable: [] };
  const rows = await repo.keysIn(['active', 'suspended', 'unavailable', 'destroyed']);
  return {
    sealing: new Map(rows.filter((k) => k.state === 'active').map((k) => [k.workspaceId, `${k.workspaceId}:${k.currentVersion}`])),
    unusable: rows.filter((k) => k.state !== 'active').map((k) => k.workspaceId),
  };
}

export async function hasKey(workspaceId: string): Promise<boolean> {
  return (await keyOf(workspaceId)) !== null;
}

// ---- state changes ----

/**
 * What every state change does besides the row: the audit event and, for each of the workspace's
 * boards, a content event so derived plaintext (search, references) is derived again — to nothing
 * while the key can't be used, back to the content when it can (realtime's stored readers read a
 * board under an unusable key as empty). Afterwards: caches dropped everywhere, open boards re-checked.
 */
async function changeState(
  workspaceId: string,
  from: repo.KeyRow['state'][],
  to: repo.KeyRow['state'],
  reason: string | null,
  audit: { action: 'key.suspended' | 'key.resumed' | 'key.destroyed' | 'key.unavailable' | 'key.available'; actorId: string | null; metadata?: Record<string, string | number | null> },
  opts: { guard?: () => Promise<void>; onlyIf?: repo.UnwrapTried } = {},
): Promise<boolean> {
  const boards = await boardIdsInWorkspace(workspaceId);
  const moved = await repo.setState(
    workspaceId,
    from,
    to,
    reason,
    Date.now(),
    async () => {
      await recordAudit({ action: audit.action, workspaceId, actorId: audit.actorId, target: { type: 'workspace', id: workspaceId, label: null }, metadata: audit.metadata ?? {} });
      for (const id of boards) await appendOutbox(BOARD_CONTENT_TOPIC, `board:${id}`);
    },
    opts,
  );
  if (!moved) return false;
  forgetEverywhere(workspaceId, to === 'destroyed');
  await refreshWorkspaceBoards(workspaceId);
  return true;
}

/** An active key refused at its KMS becomes unavailable — only if `tried` (what was refused) is still how the key is stored. */
async function markUnavailable(workspaceId: string, reason: string, tried: repo.UnwrapTried): Promise<boolean> {
  const done = await changeState(workspaceId, ['active'], 'unavailable', reason.slice(0, 300), { action: 'key.unavailable', actorId: null, metadata: { reason: reason.slice(0, 300) } }, { onlyIf: tried });
  if (done) log(`keys: the key of workspace ${workspaceId} is unavailable: ${reason}`);
  return done;
}

/** Tries the key's current data key at its KMS now (no cache): 'ok', 'unreachable', or refused (with what was tried). */
async function probe(key: repo.KeyRow): Promise<{ r: 'ok' | 'unreachable' } | { r: 'refused'; tried: repo.UnwrapTried }> {
  const row = await repo.dataKey(key.workspaceId, key.currentVersion);
  if (!row) return { r: 'refused', tried: kekOf(key) };
  try {
    await unwrapDataKey(kekOf(key), key.workspaceId, row.wrapped);
    return { r: 'ok' };
  } catch (e) {
    if (e instanceof KeyRefusedError) return { r: 'refused', tried: { ...kekOf(key), dataKey: { version: row.version, wrapped: row.wrapped } } };
    if (e instanceof KmsUnreachableError) return { r: 'unreachable' };
    throw e;
  }
}

/**
 * The `keys:check` job: an active KMS key that the KMS now refuses becomes unavailable (a
 * customer's revocation takes effect even while instances still cache its data key); an unavailable
 * one that answers again becomes active.
 */
export async function checkKeys(): Promise<void> {
  for (const key of await repo.keysIn(['active', 'unavailable'])) {
    try {
      const p = await probe(key);
      if (key.state === 'active' && p.r === 'refused') await markUnavailable(key.workspaceId, 'the key management service refused the key', p.tried);
      else if (key.state === 'unavailable' && p.r === 'ok') await changeState(key.workspaceId, ['unavailable'], 'active', null, { action: 'key.available', actorId: null });
    } catch (e) {
      logError(`keys: checking the key of workspace ${key.workspaceId} failed`, e);
    }
  }
}

/**
 * The `keys:seal` job: content of keyed workspaces not sealed with their current data key (stored
 * before the key was turned on, sealed with an older data key, or left under another workspace's
 * key by a move) is sealed again, a few boards per round. Returns how many boards it resealed.
 */
export async function sealPendingContent(maxBoards = 50): Promise<number> {
  if (!(await keysInUse())) return 0; // nothing was ever sealed
  let done = 0;
  for (const key of await repo.keysIn(['active'])) {
    if (done >= maxBoards) break;
    try {
      const ref = `${key.workspaceId}:${key.currentVersion}`;
      const pending = await boardsNeedingReseal(await boardIdsInWorkspace(key.workspaceId), ref);
      for (const id of pending.slice(0, maxBoards - done)) {
        await resealBoard(id);
        done++;
      }
    } catch (e) {
      logError(`keys: sealing content of workspace ${key.workspaceId} failed this round`, e);
    }
  }
  if (done < maxBoards) done += await sealStrayContent(maxBoards - done);
  return done;
}

/** How many boards the sweep below looks at per round. */
const STRAY_PAGE = 1000;
/** Where that sweep goes on next round (kept per instance: any instance's round moves it on; a restart starts over). */
let strayAfter = '';

/**
 * Boards holding a row sealed under another workspace's key than the one they are in now — a save
 * that sealed for the board's previous workspace while it moved (rows are sealed before the
 * transaction that writes them), left when the reseal after the move failed. The loop above only
 * looks at workspaces with an active key; this finds them wherever they are now, keyed or not, a
 * page of boards per round, resumed where the previous round stopped. Boards whose own workspace's
 * key can't seal now wait for it (the loop above takes them once it is active again).
 */
async function sealStrayContent(budget: number): Promise<number> {
  const page = await boardWorkspacesAfter(strayAfter, STRAY_PAGE);
  const stray = new Set(await boardsSealedForAnotherWorkspace(page));
  const waiting = stray.size ? await unusableKeysAmong([...new Set(page.filter((b) => stray.has(b.id)).map((b) => b.workspaceId))]) : new Set<string>();
  let tried = 0;
  let resealed = 0;
  for (const b of page) {
    if (stray.has(b.id) && !waiting.has(b.workspaceId)) {
      if (tried >= budget) return resealed; // the rest of this page next round
      tried++;
      try {
        await resealBoard(b.id);
        resealed++;
      } catch (e) {
        logError(`keys: board ${b.id} holds content sealed under another workspace's key, and sealing it for its own failed this round`, e);
      }
    }
    strayAfter = b.id;
  }
  if (page.length < STRAY_PAGE) strayAfter = ''; // every board looked at: start over
  return resealed;
}

// ---- the admin console (security admins; destroying: owners) ----

const offered = (): WorkspaceKeyProvider[] => {
  if (!getConfig().workspaceKeys.enabled) return [];
  return ['instance', ...KMS_PROVIDERS.filter((p) => p.configured()).map((p) => p.id)];
};

export async function keyStatus(workspaceId: string, userId: string): Promise<WorkspaceKeyStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'security' });
  const key = await repo.getKey(workspaceId);
  if (!key) return { providers: offered(), key: null };
  const pending = key.state === 'active' ? (await boardsNeedingReseal(await boardIdsInWorkspace(workspaceId), `${workspaceId}:${key.currentVersion}`)).length : 0;
  return {
    providers: offered(),
    key: {
      provider: key.provider,
      kmsKeyId: key.kmsKeyId,
      state: key.state,
      reason: key.state === 'unavailable' ? key.reason : null,
      dataKeyVersion: key.currentVersion,
      createdAt: key.createdAt,
      stateChangedAt: key.stateChangedAt,
      kekRotatedAt: key.kekRotatedAt,
      pendingBoards: pending,
    },
  };
}

/**
 * The KEK a request names: `kmsKeyId` the workspace's own key at a key service — an AWS KMS ARN, a
 * Google Cloud KMS key name, an Azure Key Vault key URL or a Vault Transit key path, which says
 * which — or absent/null (the instance's).
 */
function kekFromBody(body: Record<string, unknown>): KekRef {
  const id = body.kmsKeyId;
  if (id === undefined || id === null || id === '') {
    if (!offered().includes('instance')) throw notFound();
    return { provider: 'instance', kmsKeyId: null };
  }
  const parsed = typeof id === 'string' ? parseKmsKeyId(id.trim()) : null;
  if (!parsed)
    throw new HttpError(
      400,
      'kmsKeyId must be an AWS KMS key ARN, a Google Cloud KMS key name (projects/…/cryptoKeys/…), an Azure Key Vault key URL or a Vault Transit key path (<mount>/keys/<name>)',
      'kms_key_id_invalid',
    );
  if (!offered().includes(parsed.provider.id)) throw new HttpError(400, `This server is not set up to use ${parsed.provider.name} keys`, 'kms_provider_unavailable', { provider: parsed.provider.name });
  return { provider: parsed.provider.id, kmsKeyId: parsed.keyId };
}

/** Wraps a new data key under `kek` and proves the KEK opens it again (the KMS grant works both ways). */
async function newWrappedKey(kek: KekRef, workspaceId: string): Promise<string> {
  const dek = newDataKey();
  try {
    const wrapped = await wrapDataKey(kek, workspaceId, dek);
    const back = await unwrapDataKey(kek, workspaceId, wrapped);
    if (!back.dek.equals(dek)) throw new KeyRefusedError('the key did not give back what it wrapped');
    return wrapped;
  } catch (e) {
    if (e instanceof KeyRefusedError || e instanceof KmsUnreachableError) throw badRequest(`The key could not be used: ${e.message}`);
    throw e;
  }
}

export async function createKey(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceKeyStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'security' });
  if (!offered().length) throw notFound();
  const kek = kekFromBody(body);
  const wrapped = await newWrappedKey(kek, workspaceId);
  const created = await repo.insertKey({ workspaceId, provider: kek.provider, kmsKeyId: kek.kmsKeyId, createdBy: userId, wrapped, kekRef: kekRefOf(kek) }, Date.now(), () =>
    recordAudit({ action: 'key.created', workspaceId, actorId: userId, target: { type: 'workspace', id: workspaceId, label: null }, metadata: { provider: kek.provider, kmsKeyId: kek.kmsKeyId } }),
  );
  if (!created) throw new HttpError(409, 'This workspace already has an encryption key', 'key_exists');
  forgetEverywhere(workspaceId, false);
  // Existing content is sealed in the background (the keys:seal job); start now.
  void sealPendingContent().catch((e) => logError('keys: sealing existing content failed', e));
  return keyStatus(workspaceId, userId);
}

/**
 * Rotation without downtime: every data key is unwrapped and wrapped again under the (possibly new)
 * KEK, and a new data key seals new content. Nothing else is rewritten here; older content keeps
 * opening with its version and is sealed again in the background.
 */
export async function rotateKey(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceKeyStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'security' });
  const key = await repo.getKey(workspaceId);
  if (!key) throw notFound('This workspace has no encryption key');
  if (key.state !== 'active') throw new KeyUnavailableError(workspaceId);
  const kek = 'kmsKeyId' in body ? kekFromBody(body) : kekOf(key);
  const rewrapped: Array<{ version: number; from: string; to: string }> = [];
  for (const d of await repo.dataKeys(workspaceId)) {
    const dek = await dataKeyOf(key, d.version);
    rewrapped.push({ version: d.version, from: d.wrapped, to: await wrapDataKey(kek, workspaceId, dek) });
  }
  const next = { version: key.currentVersion + 1, wrapped: await newWrappedKey(kek, workspaceId) };
  const ok = await repo.rotate(workspaceId, { provider: kek.provider, kmsKeyId: kek.kmsKeyId, rewrapped, kekRef: kekRefOf(kek), next }, Date.now(), () =>
    recordAudit({
      action: 'key.rotated',
      workspaceId,
      actorId: userId,
      target: { type: 'workspace', id: workspaceId, label: null },
      metadata: { provider: kek.provider, kmsKeyId: kek.kmsKeyId, dataKeyVersion: next.version, kekChanged: kekRefOf(kek) !== kekRefOf(kekOf(key)) },
    }),
  );
  if (!ok) throw new HttpError(409, 'The key changed meanwhile; try again', 'key_changed');
  forgetEverywhere(workspaceId, true);
  void sealPendingContent().catch((e) => logError('keys: resealing after a rotation failed', e));
  return keyStatus(workspaceId, userId);
}

export async function suspendKey(workspaceId: string, userId: string): Promise<WorkspaceKeyStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'security' });
  if (!(await changeState(workspaceId, ['active', 'unavailable'], 'suspended', null, { action: 'key.suspended', actorId: userId })))
    throw new HttpError(409, 'Only an active or unavailable key can be suspended', 'key_state');
  return keyStatus(workspaceId, userId);
}

export async function resumeKey(workspaceId: string, userId: string): Promise<WorkspaceKeyStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'security' });
  const key = await repo.getKey(workspaceId);
  if (!key || key.state !== 'suspended') throw new HttpError(409, 'Only a suspended key can be resumed', 'key_state');
  const { r } = await probe(key);
  if (r !== 'ok') throw new HttpError(409, r === 'refused' ? 'The key management service refuses the key; restore access to it first' : 'The key management service could not be reached; try again', KEY_UNAVAILABLE);
  if (!(await changeState(workspaceId, ['suspended'], 'active', null, { action: 'key.resumed', actorId: userId }))) throw new HttpError(409, 'The key changed meanwhile', 'key_state');
  return keyStatus(workspaceId, userId);
}

/** Crypto-shredding: every wrapped data key deleted. Owners only, with the workspace's name typed. Irreversible. */
export async function destroyKey(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceKeyStatus> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'owner');
  if (body.confirm !== workspace.name) throw forbidden('Type the workspace’s name to destroy its key');
  // Destroying the key destroys the content: a legal hold (#157) on anything here outranks it —
  // checked in the transaction that destroys, so a hold placed meanwhile either stops it or comes after.
  const noHold = async () => {
    if (await underLegalHoldUntilCommit({ workspaceId })) throw new HttpError(409, 'A legal hold keeps content in this workspace: its key can’t be destroyed until the hold is released.', 'legal_hold');
  };
  if (!(await changeState(workspaceId, ['active', 'suspended', 'unavailable'], 'destroyed', null, { action: 'key.destroyed', actorId: userId }, { guard: noHold })))
    throw new HttpError(409, 'There is no key to destroy', 'key_state');
  return { providers: offered(), key: (await keyStatusQuiet(workspaceId)) ?? null };
}

async function keyStatusQuiet(workspaceId: string): Promise<WorkspaceKeyStatus['key']> {
  const key = await repo.getKey(workspaceId);
  return key
    ? { provider: key.provider, kmsKeyId: key.kmsKeyId, state: key.state, reason: null, dataKeyVersion: key.currentVersion, createdAt: key.createdAt, stateChangedAt: key.stateChangedAt, kekRotatedAt: key.kekRotatedAt, pendingBoards: 0 }
    : null;
}
