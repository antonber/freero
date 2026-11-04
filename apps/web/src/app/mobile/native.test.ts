// Links the phone and tablet apps are opened with (#177): only this server's boards, docs and
// dashboard open inside the app — never another site, never another of this server's pages.
import { expect, it } from 'vitest';
import { appPathFor, pushPath } from './native';

const ORIGIN = 'https://freero.app';

it('opens freero:// and this server’s board and doc links in the app, and nothing from another site or outside boards and docs', () => {
  expect(appPathFor('freero://board/b1XyZ?item=e9', ORIGIN)).toBe('/board/b1XyZ?item=e9');
  expect(appPathFor('freero://doc/d42', ORIGIN)).toBe('/doc/d42');
  expect(appPathFor('freero://app', ORIGIN)).toBe('/app');
  expect(appPathFor('https://freero.app/board/b1XyZ?thread=t1', ORIGIN)).toBe('/board/b1XyZ?thread=t1');

  expect(appPathFor('https://freero.app.evil.example/board/b1', ORIGIN)).toBeNull();
  expect(appPathFor('https://evil.example/board/b1', ORIGIN)).toBeNull();
  expect(appPathFor('freero://settings/../../api/auth/logout', ORIGIN)).toBeNull();
  expect(appPathFor('https://freero.app/api/auth/logout', ORIGIN)).toBeNull();
  expect(appPathFor('javascript:alert(1)', ORIGIN)).toBeNull();
  // A pushed notification's page is an app path, never another site.
  expect(pushPath({ path: '//evil.example/x' })).toBeNull();
  expect(pushPath({ path: '/board/b1?thread=t1' })).toBe('/board/b1?thread=t1');
});
