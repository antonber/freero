import { expect, it } from 'vitest';
import { sharedFromQuery, takeShare, holdShare } from './pendingShare';

it('a crafted /share link can only offer our own stored images and an http(s) link, never another path, an attachment or a script URL', () => {
  const q = new URLSearchParams('i=abcdefgh.png&i=../../api/boards&i=secretfile.bin&i=x.png&url=javascript:alert(1)&text=https://example.com/post');
  const s = sharedFromQuery(q);
  expect(s.images).toEqual(['/uploads/abcdefgh.png']);
  expect(s.link).toBe('https://example.com/post'); // the address arrived as text (Android does this)
  expect(s.text).toBeNull();
});

it('shared content is handed to the board it was meant for exactly once (a reload or another board places nothing)', () => {
  holdShare('b1', { images: [], link: 'https://example.com', text: null, title: null });
  expect(takeShare('b2')).toBeNull();
  expect(takeShare('b1')?.link).toBe('https://example.com');
  expect(takeShare('b1')).toBeNull();
});
