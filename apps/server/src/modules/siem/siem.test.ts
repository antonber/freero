// Audit streaming to a SIEM (#17), against local receivers: an HTTP server standing in for Splunk's
// HTTP Event Collector, Microsoft Entra ID + the Logs Ingestion API and a generic collector, and a
// TLS syslog server with its own certificate.
import { createHmac } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { recordAudit } from '../audit/index';
import { createUser } from '../auth/index';
import { createTeamWorkspace } from '../workspaces/index';
import { createSink, deliverDueSinks, listSinks, updateSink } from './service';
import { checkSinkUrl } from './transport';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

interface Received {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** Answered 2xx (the SIEM took it). */
  ok: boolean;
}
let receiver: http.Server;
let base = '';
const received: Received[] = [];
let failing = false;

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body, ok: !failing });
      if (failing) return void res.writeHead(503).end('down');
      if (req.url?.includes('/oauth2/v2.0/token')) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'entra-token-1', expires_in: 3600 }));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"text":"Success","code":0}');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  await openTestDb({ SIEM_PRIVATE_ENDPOINTS: 'true', SIEM_AZURE_AUTHORITY: `${base}/entra`, SIEM_RETRY_BASE_MS: '10' });
});
afterAll(async () => {
  await new Promise((r) => receiver.close(r));
  await closeTestDb();
});

let n = 0;
async function team() {
  const owner = await createUser({ name: 'Owner', email: `siem-${++n}-${Date.now()}@siem.test`, password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, `SIEM ${n}`);
  return { owner, ws };
}
const record = (workspaceId: string, i: number) => recordAudit({ action: 'board.created', workspaceId, actorId: null, target: { type: 'board', id: `b${i}` } });
/** Splunk HEC batches are concatenated JSON objects, one per line here. */
const splunkEvents = (r: Received) => r.body.split('\n').map((l) => JSON.parse(l) as { event: { type: string; seq: number; hash: string; prevHash: string } });

it('the secrets of a stream never come back to the browser: HEC token, client secret, bearer token, the collector URL’s own token; the signing secret only once', async () => {
  const { owner, ws } = await team();
  const answers: unknown[] = [];
  answers.push(await createSink(ws.id, owner.id, { kind: 'splunk', settings: { url: `${base}/hec` }, secret: 'hec-SECRET-1' }));
  answers.push(
    await createSink(ws.id, owner.id, {
      kind: 'sentinel',
      settings: { endpoint: `${base}/dce`, dcrId: `dcr-${'a'.repeat(32)}`, stream: 'Custom-FreeroAudit_CL', tenantId: 'contoso.example', clientId: '11111111-2222-3333-4444-555555555555' },
      secret: 'entra-SECRET-2',
    }),
  );
  const https = await createSink(ws.id, owner.id, { kind: 'https', settings: { url: `${base}/collect/x?token=url-SECRET-3` }, secret: 'bearer-SECRET-4' });
  expect(https.signingSecret).toMatch(/^siemsec_/);
  answers.push(https.sink);
  answers.push(await updateSink(ws.id, owner.id, (https.sink as { id: string }).id, { secret: 'bearer-SECRET-5', name: 'Collector' }));
  answers.push(await listSinks(ws.id, owner.id));
  const text = JSON.stringify(answers);
  for (const secret of ['hec-SECRET-1', 'entra-SECRET-2', 'url-SECRET-3', 'bearer-SECRET-4', 'bearer-SECRET-5', https.signingSecret!]) expect(text).not.toContain(secret);
});

it('a stream receives every audit event in order with its chain hashes; while the SIEM is down nothing is skipped, and the backlog arrives in order once it is back; the signed head checkpoint matches the streamed chain', async () => {
  const { owner, ws } = await team();
  const { sink } = await createSink(ws.id, owner.id, { kind: 'splunk', settings: { url: `${base}/splunk-${ws.id}` }, secret: 'hec-token' });
  for (let i = 0; i < 3; i++) await record(ws.id, i);
  const mine = () => received.filter((r) => r.path.startsWith(`/splunk-${ws.id}/services/collector/event`));
  await deliverDueSinks();
  expect(mine()[0].headers.authorization).toBe('Splunk hec-token');

  failing = true;
  for (let i = 3; i < 6; i++) await record(ws.id, i);
  await deliverDueSinks();
  failing = false;
  expect((await listSinks(ws.id, owner.id)).find((s) => s.id === sink.id)).toMatchObject({ status: 'failing', consecutiveFailures: 1 });
  await deliverDueSinks(Date.now() + 60_000);

  expect(mine().filter((r) => !r.ok)).toHaveLength(1);
  const events = mine()
    .filter((r) => r.ok)
    .flatMap(splunkEvents)
    .map((e) => e.event);
  const audit = events.filter((e) => e.type === 'freero.audit.event');
  expect(audit.map((e) => e.seq)).toEqual(audit.map((_, i) => audit[0].seq + i)); // consecutive: nothing skipped or repeated
  for (let i = 1; i < audit.length; i++) expect(audit[i].prevHash).toBe(audit[i - 1].hash);
  expect(audit.length).toBe(7); // siem.sink_created + 6
  // The signed head checkpoint names an event the stream has, with that event's hash.
  const heads = events.filter((e) => e.type === 'freero.audit.head');
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(h.hash).toBe(audit.find((e) => e.seq === h.seq)?.hash);
  expect((await listSinks(ws.id, owner.id)).find((s) => s.id === sink.id)).toMatchObject({ status: 'ok', deliveredSeq: audit.at(-1)!.seq });
});

it('Microsoft Sentinel streams sign in to Entra ID with client credentials and post rows to the data collection rule’s stream; HTTPS collectors get a body signed with their secret', async () => {
  const { owner, ws } = await team();
  await createSink(ws.id, owner.id, {
    kind: 'sentinel',
    settings: { endpoint: base, dcrId: `dcr-${'b'.repeat(32)}`, stream: 'Custom-FreeroAudit_CL', tenantId: 'contoso.example', clientId: '11111111-2222-3333-4444-555555555555' },
    secret: 'client-secret',
  });
  const { signingSecret } = await createSink(ws.id, owner.id, { kind: 'https', settings: { url: `${base}/generic-${ws.id}` } });
  await deliverDueSinks();

  const token = received.find((r) => r.path === '/entra/contoso.example/oauth2/v2.0/token' && r.body.includes('client_secret=client-secret'));
  expect(new URLSearchParams(token!.body).get('grant_type')).toBe('client_credentials');
  const rows = received.find((r) => r.path.startsWith(`/dataCollectionRules/dcr-${'b'.repeat(32)}/streams/Custom-FreeroAudit_CL?api-version=`));
  expect(rows!.headers.authorization).toBe('Bearer entra-token-1');
  expect((JSON.parse(rows!.body) as Array<{ Action?: string }>).some((r) => r.Action === 'siem.sink_created')).toBe(true);

  const generic = received.find((r) => r.path === `/generic-${ws.id}`)!;
  const [t, v1] = String(generic.headers['freero-signature']).split(',').map((p) => p.split('=')[1]);
  expect(v1).toBe(createHmac('sha256', signingSecret!).update(`${t}.${generic.body}`).digest('hex'));
});

it('syslog streams go over TLS with a verified certificate: octet-counted RFC 5424 frames to a server on the named CA, nothing to one with an untrusted certificate', async () => {
  const { selfSignedCertificate } = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/test-cert.mjs')).href)) as {
    selfSignedCertificate: (cn: string) => { privateKeyPem: string; certPem: string };
  };
  const cert = selfSignedCertificate('localhost');
  let frames = '';
  const server = tls.createServer({ key: cert.privateKeyPem, cert: cert.certPem }, (s) => s.on('data', (d) => (frames += d)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const { owner, ws } = await team();
    const untrusted = await createSink(ws.id, owner.id, { kind: 'syslog', settings: { host: 'localhost', port } });
    await deliverDueSinks();
    expect(frames).toBe('');
    expect((await listSinks(ws.id, owner.id)).find((s) => s.id === untrusted.sink.id)?.lastError).toMatch(/certificate/);

    await updateSink(ws.id, owner.id, untrusted.sink.id, { settings: { caCert: cert.certPem } });
    await deliverDueSinks(Date.now() + 60_000);
    expect((await listSinks(ws.id, owner.id)).find((s) => s.id === untrusted.sink.id)?.lastError).toBeNull();
    for (let i = 0; i < 100 && !frames; i++) await new Promise((r) => setTimeout(r, 20)); // the server reads what the stream wrote
    const first = /^(\d+) /.exec(frames)!;
    const message = frames.slice(first[0].length, first[0].length + Number(first[1]));
    expect(message).toMatch(/^<110>1 \S+ \S+ freero - siem\.sink_created - \{/);
    expect(JSON.parse(message.slice(message.indexOf('{')))).toMatchObject({ type: 'freero.audit.event', action: 'siem.sink_created' });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

it('streams are never pointed at private or local addresses (unless the operator allows private endpoints), nor carry credentials in the URL', () => {
  for (const u of ['http://siem.example.com/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://localhost/x', 'https://user:pw@siem.example.com/x'])
    expect(() => checkSinkUrl(u, false), u).toThrow();
  expect(checkSinkUrl('https://siem.example.com:8088', false).host).toBe('siem.example.com:8088');
});
