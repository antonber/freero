import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAll, initStorage, storage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { uploadBytesUsed } from '../uploads/index';
import { isBlockedAddress, type FetchOptions } from './fetch';
import { importRemoteImage } from './image';

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// A host without CORS headers, as most image hosts are. It runs on loopback, so the tests reach it
// through a test network: "images.test" resolves to it and only its address is let through —
// every other address is judged by the real isBlockedAddress.
let server: http.Server;
let net: NonNullable<FetchOptions['testNetwork']>;
let ownerId: string;

beforeAll(async () => {
  const config = await openTestDb();
  initStorage(config);
  ownerId = (await createUser({ name: 'Img', email: 'img@test.freero.app', password: 'password-123' })).id;
  server = http.createServer((req, res) => {
    if (req.url === '/photo') return res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(PNG);
    if (req.url === '/fake.png') return res.writeHead(200, { 'Content-Type': 'image/png' }).end('<html><script>alert(1)</script></html>');
    if (req.url === '/to-internal') return res.writeHead(302, { Location: 'http://internal.test/latest/meta-data' }).end();
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const hosts: Record<string, string> = { 'images.test': '127.0.0.1', 'internal.test': '169.254.169.254' };
  net = {
    port: (server.address() as AddressInfo).port,
    resolve: (host, _opts, cb) =>
      hosts[host] ? cb(null, [{ address: hosts[host], family: 4 }]) : cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), []),
    isBlocked: (ip) => ip !== '127.0.0.1' && isBlockedAddress(ip),
  };
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

describe('images placed by URL are copied to our uploads (exports can read them)', () => {
  it('an image from a host without CORS is stored byte for byte, typed by its content', async () => {
    const url = await importRemoteImage('http://images.test/photo', ownerId, 1024 * 1024, net);
    expect(url).toMatch(/^\/uploads\/[A-Za-z0-9_-]+\.png$/);
    const obj = await storage().get(url.slice('/uploads/'.length));
    expect(await readAll(obj!)).toEqual(PNG);
  });

  it('a page that claims to be an image is refused and nothing is stored', async () => {
    const before = await uploadBytesUsed(ownerId);
    await expect(importRemoteImage('http://images.test/fake.png', ownerId, 1024 * 1024, net)).rejects.toThrow(/not an image/);
    expect(await uploadBytesUsed(ownerId)).toBe(before);
  });

  it('a redirect to a name that resolves to an internal address is refused at connect time', async () => {
    await expect(importRemoteImage('http://images.test/to-internal', ownerId, 1024 * 1024, net)).rejects.toThrow(/not reachable/);
  });
});
