// The case export job (#186): every export ends (ready, or failed after a bounded number of
// attempts, even when its build takes its instance down), and no case archive a build stored
// outlives its export, whatever became of the build.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initStorage, storage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { newPrivateFileKey } from '../uploads/index';
import * as repo from './repo';
import { processCaseExports } from './service';

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

const openCase = (id: string) => repo.insertCase({ id, placeId: 'ws-x', placeKind: 'team', name: 'Case', description: '', createdBy: 'u-x', workspaceIds: [] }, Date.now());

it('a case export whose build keeps taking its instance down fails after three attempts and no longer blocks a new one', async () => {
  await openCase('case-crash');
  expect(await repo.insertExport({ id: 'cexp-crashing', caseId: 'case-crash', requestedBy: 'u-x' }, Date.now())).toBe(true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    expect((await repo.claimNext(Date.now(), newPrivateFileKey()))?.id).toBe('cexp-crashing');
    await repo.requeueStale(Date.now() + 1); // the instance died mid-build; a later round finds it still running
  }
  expect(await repo.claimNext(Date.now(), newPrivateFileKey())).toBeNull();
  expect((await repo.getExport('cexp-crashing'))?.status).toBe('failed');
  expect(await repo.insertExport({ id: 'cexp-again', caseId: 'case-crash', requestedBy: 'u-x' }, Date.now())).toBe(true);
});

it('a case archive stored by a build that never became ready is deleted from storage once its export fails', async () => {
  await openCase('case-leak');
  expect(await repo.insertExport({ id: 'cexp-leak', caseId: 'case-leak', requestedBy: 'u-x' }, Date.now())).toBe(true);
  db.markReadyFails = true; // the archive is written, then the database fails before the export is marked ready
  try {
    await processCaseExports();
  } finally {
    db.markReadyFails = false;
  }
  expect((await repo.getExport('cexp-leak'))?.status).toBe('failed');
  await processCaseExports();
  expect(await privateFiles()).toEqual([]);
});
