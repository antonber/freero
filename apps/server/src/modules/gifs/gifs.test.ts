import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createTeamWorkspace, inviteToWorkspace, updateWorkspace } from '../workspaces/index';
import { readPage, searchUrl } from './provider';
import { mediaToken, mediaUrl, placeGif, searchGifs } from './service';

beforeAll(async () => {
  await openTestDb({ GIF_PROVIDER: 'giphy', GIF_API_KEY: 'test-key' });
});
afterAll(() => closeTestDb());

const keys = { apiKey: 'k', clientKey: 'freero' };
const giphyItem = (id: string, rating: string) => ({
  id,
  title: id,
  rating,
  images: {
    fixed_width_small: { url: `https://media.giphy.com/${id}/100w.gif`, width: '100', height: '80' },
    downsized_medium: { url: `https://media.giphy.com/${id}/giphy.gif`, width: '480', height: '384' },
  },
});

it('a G-only workspace never gets PG-13 GIFs: the provider is asked for G, and a stray PG-13 result is dropped', () => {
  expect(new URL(searchUrl('giphy', keys, 'party', null, 'g', 'en')).searchParams.get('rating')).toBe('g');
  expect(new URL(searchUrl('tenor', keys, 'party', null, 'g', 'en')).searchParams.get('contentfilter')).toBe('high');

  const answer = { data: [giphyItem('ok', 'g'), giphyItem('edgy', 'pg-13'), giphyItem('unrated', '')], pagination: { total_count: 3 } };
  expect(readPage('giphy', answer, 'g', null).gifs.map((g) => g.id)).toEqual(['ok']);
  expect(readPage('giphy', answer, 'pg-13', null).gifs.map((g) => g.id)).toEqual(['ok', 'edgy']);
});

it('the preview proxy and placing only fetch links this server signed: an edited or made-up link is refused', () => {
  const url = 'https://media.giphy.com/abc/giphy.gif';
  expect(mediaUrl(mediaToken(url))).toBe(url);
  const [, sig] = mediaToken(url).split('.');
  const other = Buffer.from('https://evil.example/steal.gif').toString('base64url');
  expect(mediaUrl(`${other}.${sig}`)).toBeNull();
  expect(mediaUrl(Buffer.from('http://169.254.169.254/latest').toString('base64url') + '.AAAA')).toBeNull();
});

it('a workspace that turned GIF search off refuses searches and placing on its boards, before anything reaches the provider', async () => {
  const owner = await createUser({ name: 'Owner', email: 'gif-owner@test.freero.app', password: 'password-123' }, { emailVerified: true });
  const member = await createUser({ name: 'Member', email: 'gif-member@test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Strict team');
  await inviteToWorkspace(null, ws.id, owner, { email: member.email, role: 'member' });
  const board = await createBoard(owner.id, 'Retro', '', 'none', { workspaceId: ws.id });
  await updateWorkspace(ws.id, owner.id, { policies: { gifs: 'off' } });

  await expect(searchGifs(board.id, member.id, 'party', null, 'en')).rejects.toMatchObject({ status: 403, code: 'gifs_off' });
  await expect(placeGif(board.id, member.id, mediaToken('https://media.giphy.com/abc/giphy.gif'))).rejects.toMatchObject({ status: 403, code: 'gifs_off' });
});
