// The sensitive-data scan on real stored boards (#158): saves raise outbox events, the consumer
// scans what every reader sees, admins are told, a required label is given and kept — and the text
// that matched is never stored, logged, audited or sent anywhere.
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { BoardElement } from '@freero/shared';
import { logger } from '../../platform/log';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser } from '../auth/index';
import { boardLabelId, createBoard, onLabelChange, registerBoardObjectTypes, setBoardLabel } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { notificationsExportOf } from '../notifications/index';
import { initBoardDoc } from '../realtime/index';
import { createLabel, createTeamWorkspace } from '../workspaces/index';
import { boardSensitiveData, DLP_CONSUMER, dlpConsumer, guardLabelChange, sensitiveDataStatus, updateSensitiveDataSettings } from './index';

beforeAll(async () => {
  await openTestDb();
  registerBoardObjectTypes();
  registerOutboxConsumer(dlpConsumer);
  onLabelChange(guardLabelChange);
});
afterAll(() => closeTestDb());
afterEach(() => vi.restoreAllMocks());

let n = 0;
const person = (label: string) => createUser({ name: label, email: `${label.toLowerCase()}-${++n}@dlp.test.freero.app`, password: 'password-123' }, { emailVerified: true });
let z = 0;
const sticky = (id: string, text: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, text, color: 'yellow' }) as BoardElement;
async function save(boardId: string, stickies: BoardElement[]) {
  const doc = new Y.Doc();
  for (const e of stickies) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(doc));
}

const CARD = '4111 1111 1111 1111';
const AWS = 'AKIAIOSFODNN7EXAMPLE';
const IBAN = 'DE89370400440532013000';

async function regulatedWorkspace() {
  const owner = await person('Owner');
  const ws = (await createTeamWorkspace(owner.id, `Payments ${n}`)).id;
  const internal = await createLabel(ws, owner.id, { name: 'Internal', caps: { publicLinks: 'signedIn' } });
  const confidential = await createLabel(ws, owner.id, { name: 'Confidential', caps: { publicLinks: 'signedIn', downloads: 'admins', linkSharing: 'none' } });
  const restricted = await createLabel(ws, owner.id, { name: 'Restricted', caps: { publicLinks: 'signedIn', downloads: 'admins', linkSharing: 'none', boardEmbeds: 'off' } });
  return { owner, ws, internal, confidential, restricted };
}

it('a card number and an AWS key on a board: admins are told and the board gets the required label — and neither the card nor the key appears in findings, notifications, the audit log or the logs', async () => {
  const { owner, ws, confidential } = await regulatedWorkspace();
  const logged: string[] = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => void logged.push(JSON.stringify(args))) as never);

  await updateSensitiveDataSettings(ws, owner.id, { enabled: true, action: 'require', labelId: confidential.id });
  const board = await createBoard(owner.id, 'Vendor onboarding', '', 'none', { workspaceId: ws });
  await save(board.id, [sticky('s1', `Corporate card ${CARD}, exp 09/28`), sticky('s2', `deploy key ${AWS}`), sticky('s3', `Wire to ${IBAN}`)]);
  await drainOutbox(DLP_CONSUMER);

  const status = await sensitiveDataStatus(ws, owner.id);
  expect(status.findings.map((f) => `${f.elementId}:${f.kind}`).sort()).toEqual(['s1:payment_card', 's2:secret', 's3:iban']);
  expect(await boardLabelId(board.id)).toBe(confidential.id);
  const notes = (await notificationsExportOf(owner.id)).notifications as Array<{ type: string }>;
  expect(notes.filter((x) => x.type === 'sensitive_data.found')).toHaveLength(1);
  const audit = await listAuditEvents({ workspaceId: ws }, 100);
  expect(audit.some((e) => e.action === 'board.label_changed')).toBe(true);

  const everywhere = JSON.stringify([status, notes, audit, await boardSensitiveData(board.id, owner.id), logged]);
  for (const secret of [CARD, CARD.replace(/ /g, ''), AWS, IBAN, IBAN.slice(4, 16)]) expect(everywhere).not.toContain(secret);
});

it('while a board holds findings its required label can only be swapped for one at least as strict; once the data is gone it can be lowered again', async () => {
  const { owner, ws, internal, confidential, restricted } = await regulatedWorkspace();
  await updateSensitiveDataSettings(ws, owner.id, { enabled: true, action: 'require', labelId: confidential.id });
  const board = await createBoard(owner.id, 'Payroll', '', 'none', { workspaceId: ws });
  await save(board.id, [sticky('s1', `SSN 078-05-1120`)]);
  await drainOutbox(DLP_CONSUMER);
  expect(await boardLabelId(board.id)).toBe(confidential.id);

  await expect(setBoardLabel(board.id, owner.id, internal.id)).rejects.toMatchObject({ status: 409, code: 'label_required_by_scan' });
  await expect(setBoardLabel(board.id, owner.id, null)).rejects.toMatchObject({ status: 409 });
  await setBoardLabel(board.id, owner.id, restricted.id); // stricter: fine
  expect(await boardLabelId(board.id)).toBe(restricted.id);

  await save(board.id, [sticky('s1', 'SSN removed, see the HR system')]);
  await drainOutbox(DLP_CONSUMER);
  await setBoardLabel(board.id, owner.id, internal.id);
  expect(await boardLabelId(board.id)).toBe(internal.id);
});

it("a suggested label is shown to the board's owner, not to an editor, and nothing is scanned or kept once the workspace turns the scan off", async () => {
  const { owner, ws, confidential } = await regulatedWorkspace();
  await updateSensitiveDataSettings(ws, owner.id, { enabled: true, action: 'suggest', labelId: confidential.id });
  const board = await createBoard(owner.id, 'Keys', '', 'none', { workspaceId: ws });
  await save(board.id, [sticky('s1', `token ${AWS}`)]);
  await drainOutbox(DLP_CONSUMER);
  expect(await boardSensitiveData(board.id, owner.id)).toMatchObject({ kinds: ['secret'], action: 'suggest', label: { id: confidential.id } });
  expect(await boardLabelId(board.id)).toBeNull(); // suggested, not given
  const editor = await person('Editor');
  await inviteBoardMember(null, board.id, owner, { email: editor.email, role: 'editor' });
  expect(await boardSensitiveData(board.id, editor.id)).toEqual({ kinds: [], action: null, label: null });

  await updateSensitiveDataSettings(ws, owner.id, { enabled: false });
  expect((await sensitiveDataStatus(ws, owner.id)).findings).toEqual([]);
  await save(board.id, [sticky('s2', `another ${AWS}`)]);
  await drainOutbox(DLP_CONSUMER);
  expect((await sensitiveDataStatus(ws, owner.id)).findings).toEqual([]);
});
