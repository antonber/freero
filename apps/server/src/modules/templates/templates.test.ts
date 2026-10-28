import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TemplateContent } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from './service';

const LIMIT = 2;
beforeAll(() => openTestDb({ MAX_TEMPLATES_PER_USER: String(LIMIT) }));
afterAll(() => closeTestDb());

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' });

// A frame with a sticky inside and table cells kept outside the elements map, keyed by element id.
const content = {
  elements: [
    { id: 'f1', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Retro', index: 3 },
    { id: 's1', type: 'sticky', x: 20, y: 40, w: 100, h: 100, frameId: 'f1', text: '<p>Went well</p>' },
  ],
  content: { s1: { cells: { 'r0:c0': 'Ä' } } },
} as unknown as TemplateContent;

it('a saved template comes back intact for its owner and stays invisible to everyone else', async () => {
  const owner = await user('Owner');
  const other = await user('Other');
  const saved = await saveTemplate(owner.id, { name: '  Weekly retro ', description: 'Ours', content });
  expect(saved).toMatchObject({ name: 'Weekly retro', elementCount: 2 });

  expect((await getTemplate(saved.id, owner.id)).content).toEqual(content);
  expect(await listTemplates(other.id)).toEqual([]);
  await expect(getTemplate(saved.id, other.id)).rejects.toMatchObject({ status: 404 });
  await expect(deleteTemplate(saved.id, other.id)).rejects.toMatchObject({ status: 404 });
  expect((await listTemplates(owner.id)).map((t) => t.id)).toEqual([saved.id]);
});

it('parallel saves by one user never land over the template limit', async () => {
  const u = await user('Saver');
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => saveTemplate(u.id, { name: `T${i}`, content })));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LIMIT);
  expect(await listTemplates(u.id)).toHaveLength(LIMIT);
});

it('refuses content the board could not insert (no elements, duplicate ids)', async () => {
  const u = await user('Sloppy');
  await expect(saveTemplate(u.id, { name: 'Empty', content: { elements: [] } })).rejects.toMatchObject({ status: 400 });
  const dup = { elements: [content.elements[1], content.elements[1]] } as TemplateContent;
  await expect(saveTemplate(u.id, { name: 'Dup', content: dup })).rejects.toMatchObject({ status: 400 });
  expect(await listTemplates(u.id)).toEqual([]);
});
