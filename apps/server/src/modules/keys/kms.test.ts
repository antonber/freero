// A workspace's own AWS KMS key (#159): the customer's revocation is what closes its content, and
// requests are signed the way AWS checks them.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { initBoardDoc, storedBoardView } from '../realtime/index';
import { boardAccess, createTeamWorkspace } from '../workspaces/index';
import { newDataKey } from './envelope';
import { unwrapDataKey, wrapDataKey } from './kek';
import * as repo from './repo';
import { checkKeys, createKey, currentSealRef, forgetAllCachedKeys, keyStatus } from './service';
import { signRequest } from './sigv4';

const ARN = 'arn:aws:kms:eu-west-1:111122223333:key/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
const OTHER_ARN = 'arn:aws:kms:eu-west-1:111122223333:key/ffffffff-0000-1111-2222-333333333333';
const MOVED_ARN = 'arn:aws:kms:eu-west-1:111122223333:key/12345678-9abc-def0-1234-56789abcdef0';

/** A stand-in for AWS KMS: Encrypt / Decrypt bound to the encryption context, keys that can be disabled. */
const kms = { disabled: new Set<string>(), calls: 0 };
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      kms.calls++;
      const fail = (type: string) => res.writeHead(400, { 'content-type': 'application/x-amz-json-1.1' }).end(JSON.stringify({ __type: type, message: type }));
      if (!String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256 Credential=AKIATEST/')) return fail('UnrecognizedClientException');
      const b = JSON.parse(body) as { KeyId: string; Plaintext?: string; CiphertextBlob?: string; EncryptionContext: Record<string, string> };
      if (kms.disabled.has(b.KeyId)) return fail('DisabledException');
      const action = req.headers['x-amz-target'];
      if (action === 'TrentService.Encrypt')
        return res.end(JSON.stringify({ KeyId: b.KeyId, CiphertextBlob: Buffer.from(JSON.stringify({ k: b.KeyId, c: b.EncryptionContext, p: b.Plaintext })).toString('base64') }));
      const sealed = JSON.parse(Buffer.from(b.CiphertextBlob!, 'base64').toString()) as { k: string; c: Record<string, string>; p: string };
      if (sealed.k !== b.KeyId || JSON.stringify(sealed.c) !== JSON.stringify(b.EncryptionContext)) return fail('InvalidCiphertextException');
      res.end(JSON.stringify({ KeyId: b.KeyId, Plaintext: sealed.p }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  await openTestDb({
    WORKSPACE_KEYS: 'true',
    KMS_AWS_ACCESS_KEY_ID: 'AKIATEST',
    KMS_AWS_SECRET_ACCESS_KEY: 'secret',
    KMS_AWS_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    WORKSPACE_KEY_CACHE_SECONDS: '300',
  });
});
afterAll(async () => {
  await closeTestDb();
  await new Promise((r) => server.close(r));
});

it("a customer revoking their AWS KMS key closes the workspace's boards although instances still cache its data key, and restoring access opens them again", async () => {
  const me = await createUser({ name: 'Customer', email: 'kms@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = (await createTeamWorkspace(me.id, 'Regulated')).id;
  await createKey(ws, me.id, { kmsKeyId: ARN });
  const board = await createBoard(me.id, 'Ledger', '', 'none', { workspaceId: ws });
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 1, h: 1, text: 'account 4711' });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  expect((await storedBoardView(board.id))?.elements).toHaveLength(1); // data key now cached here

  kms.disabled.add(ARN); // the customer disables the key (or revokes Freero's grant)
  await checkKeys();
  expect((await keyStatus(ws, me.id)).key?.state).toBe('unavailable');
  expect((await boardAccess(me.id, { workspaceId: ws, projectId: null })).blocked).toBe('key_unavailable');
  expect(await storedBoardView(board.id)).toBeNull();

  kms.disabled.delete(ARN);
  await checkKeys();
  expect((await keyStatus(ws, me.id)).key?.state).toBe('active');
  expect((await storedBoardView(board.id))?.elements).toHaveLength(1);
});

it('an instance still caching the key row from before another instance moved the key to a KMS key opens the board and never marks the key unavailable', async () => {
  const me = await createUser({ name: 'Rotator', email: 'kms3@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = (await createTeamWorkspace(me.id, 'Rotating')).id;
  await createKey(ws, me.id, {}); // the instance's key
  const board = await createBoard(me.id, 'Ledger 2', '', 'none', { workspaceId: ws });
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 1, h: 1, text: 'account 4712' });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));

  forgetAllCachedKeys();
  await currentSealRef(ws); // this instance caches the key row (the instance's KEK), no data key yet
  // Another instance rotates to the customer's KMS key; its invalidation hasn't reached this one.
  const theirs = { provider: 'aws-kms' as const, kmsKeyId: MOVED_ARN };
  const rewrapped = [];
  for (const d of await repo.dataKeys(ws)) {
    const { dek } = await unwrapDataKey({ provider: 'instance', kmsKeyId: null }, ws, d.wrapped);
    rewrapped.push({ version: d.version, from: d.wrapped, to: await wrapDataKey(theirs, ws, dek) });
  }
  const next = { version: 2, wrapped: await wrapDataKey(theirs, ws, newDataKey()) };
  expect(await repo.rotate(ws, { ...theirs, rewrapped, kekRef: MOVED_ARN, next }, Date.now(), async () => {})).toBe(true);

  expect((await storedBoardView(board.id))?.elements).toHaveLength(1);
  expect((await keyStatus(ws, me.id)).key?.state).toBe('active');
});

it("a workspace can't turn on a KMS key Freero can't use, so it never seals content it couldn't open again", async () => {
  const me = await createUser({ name: 'Careful', email: 'kms2@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = (await createTeamWorkspace(me.id, 'Careful')).id;
  kms.disabled.add(OTHER_ARN);
  await expect(createKey(ws, me.id, { kmsKeyId: OTHER_ARN })).rejects.toMatchObject({ status: 400 });
  expect((await keyStatus(ws, me.id)).key).toBeNull();
});

it("KMS requests are signed exactly as AWS's published Signature Version 4 test suite expects (any difference and every call is refused)", () => {
  const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
  const now = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));
  const vanilla = signRequest({ method: 'GET', url: new URL('https://example.amazonaws.com/'), headers: { host: 'example.amazonaws.com' }, body: '', region: 'us-east-1', service: 'service', credentials, now });
  expect(vanilla.authorization).toBe(
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
  const iam = signRequest({
    method: 'GET',
    url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
    headers: { host: 'iam.amazonaws.com', 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: '',
    region: 'us-east-1',
    service: 'iam',
    credentials,
    now,
  });
  expect(iam.authorization).toContain('Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
});
