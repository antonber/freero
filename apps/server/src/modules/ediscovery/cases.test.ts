// A case's export (#157) is the record, not one person's view: every layer of every held board
// (hidden frames' contents too) and every version, the audit trail about them, and a manifest a
// reviewer can check the files against.
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { freezeBoard, initBoardDoc, initBoardLayer } from '../realtime/index';
import { createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { createCase } from './index';
import * as repo from './repo';
import { processCaseExports, requestCaseExport } from './service';
import { openPrivateFile } from '../uploads/index';

beforeAll(async () => initStorage(await openTestDb()));
afterAll(() => closeTestDb());

const stateWith = (collection: string, key: string, value: unknown) => {
  const doc = new Y.Doc();
  doc.getMap(collection).set(key, value);
  return Y.encodeStateAsUpdate(doc);
};

async function readZip(key: string): Promise<Record<string, Uint8Array>> {
  const file = (await openPrivateFile(key))!;
  const chunks: Buffer[] = [];
  for await (const c of file.body) chunks.push(Buffer.from(c));
  return unzipSync(new Uint8Array(Buffer.concat(chunks)));
}

it('a case export carries every layer and version of a held board, its audit trail, and a manifest whose hashes match the files', async () => {
  const owner = await createUser({ name: 'Counsel', email: 'counsel@cases.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const custodian = await createUser({ name: 'Custodian', email: 'custodian@cases.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Litigation');
  await inviteToWorkspace(null, ws.id, owner, { email: custodian.email, role: 'member' });
  const board = await createBoard(custodian.id, 'Pricing call', '', 'none', { workspaceId: ws.id });
  await initBoardDoc(board.id, stateWith('elements', 'e1', { type: 'sticky', text: 'shared note' }));
  await initBoardLayer(board.id, 'editors', stateWith('elements', 'e2', { type: 'sticky', text: 'hidden frame note' }));
  await freezeBoard(board.id, custodian.id, 'Before the call', () => null);

  const c = await createCase(ws.id, owner.id, { name: 'Pricing inquiry', custodianIds: [custodian.id] });
  const requested = await requestCaseExport(ws.id, c.id, owner.id);
  await processCaseExports();
  const e = (await repo.getExport(requested.id))!;
  expect(e.status).toBe('ready');
  const files = await readZip(e.fileKey!);

  const content = JSON.parse(strFromU8(files[`boards/${board.id}/content.json`]));
  expect(JSON.stringify(content.content)).toContain('shared note');
  expect(JSON.stringify(content.layers.editors)).toContain('hidden frame note');
  const versions = Object.keys(files).filter((p) => p.startsWith(`boards/${board.id}/versions/`));
  expect(versions).toHaveLength(1);
  const audit = JSON.parse(strFromU8(files['audit.json'])) as Array<{ action: string; targetId: string | null }>;
  expect(audit.some((a) => a.action === 'board.created' && a.targetId === board.id)).toBe(true);

  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { files: Array<{ path: string; sha256: string }> };
  expect(manifest.files.map((f) => f.path).sort()).toEqual(Object.keys(files).filter((p) => p !== 'manifest.json').sort());
  for (const f of manifest.files) expect(createHash('sha256').update(files[f.path]).digest('hex')).toBe(f.sha256);
});
