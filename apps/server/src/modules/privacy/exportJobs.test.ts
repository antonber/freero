// The data export job (#186): every export ends (ready, or failed after a bounded number of
// attempts, even when its build takes its instance down), and no archive a build stored outlives
// its export, whatever became of the build.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initStorage, storage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { newPrivateFileKey } from '../uploads/index';
import * as repo from './repo';
import { processExports, requestExport } from './service';

const db = vi.hoisted(() => ({ markReadyFails: false }));
vi.mock('./repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('./repo')>();
  return {
    ...real,
    markReady: async (...args: Parameters<typeof real.markReady>) => {
      if (db.markReadyFails) throw new Error('connection lost');
      return real.markReady(...args);
    },
  };
});

beforeAll(async () => initStorage(await openTestDb()));
afterAll(() => closeTestDb());

async function privateFiles(): Promise<string[]> {
  const keys: string[] = [];
  for await (const k of storage().list()) if (k.key.startsWith('private-')) keys.push(k.key);
  return keys;
}

it('an export whose build keeps taking its instance down fails after three attempts and no longer blocks a new one', async () => {
  const user = await createUser({ name: 'Asker', email: 'asker@exports.test.freero.app', password: 'password-123' }, { emailVerified: true });
  expect(await repo.insertExport({ id: 'exp-crashing', kind: 'user', requestedBy: user.id, workspaceId: null }, Date.now())).toBe(true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    expect((await repo.claimNext(Date.now(), newPrivateFileKey()))?.id).toBe('exp-crashing');
    await repo.requeueStale(Date.now() + 1); // the instance died mid-build; a later round finds it still running
  }
  expect(await repo.claimNext(Date.now(), newPrivateFileKey())).toBeNull();
  expect((await repo.getExport('exp-crashing'))?.status).toBe('failed');
  expect(await repo.insertExport({ id: 'exp-again', kind: 'user', requestedBy: user.id, workspaceId: null }, Date.now())).toBe(true);
});

it('an archive stored by a build that never became ready is deleted from storage once its export fails', async () => {
  const user = await createUser({ name: 'Leaver', email: 'leaver@exports.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const requested = await requestExport(user.id, null);
  db.markReadyFails = true; // the archive is written, then the database fails before the export is marked ready
  try {
    await processExports();
  } finally {
    db.markReadyFails = false;
  }
  expect((await repo.getExport(requested.id))?.status).toBe('failed');
  await processExports();
  expect(await privateFiles()).toEqual([]);
});
