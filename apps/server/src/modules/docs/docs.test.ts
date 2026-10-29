// Docs (KAI-162) against the rest of the suite, on a real (in-memory) database.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { boardUploadReferences } from '../realtime/index';
import { createDoc } from './service';

beforeAll(async () => {
  await openTestDb();
});
afterAll(() => closeTestDb());

it('an image a doc shows is kept by the uploads sweep: the reference scan reads docs’ stored documents too', async () => {
  const owner = await createUser({ name: 'Writer', email: 'writer@docs.test.freero.app', password: 'password-123' }, { emailVerified: true });
  await createDoc(owner.id, { markdown: '# Report\n\n![Chart](/uploads/docChart123.png)\n' });
  expect(await boardUploadReferences(['docChart123.png', 'unusedFile99.png'])).toEqual(['docChart123.png']);
});
