import { describe, expect, it } from 'vitest';
import { loginPath, safeNext } from './nav';

describe('safeNext', () => {
  it('keeps the in-app path and query so users return where they were', () => {
    expect(safeNext('/board/abc?dock=templates')).toBe('/board/abc?dock=templates');
  });
  it('blocks open redirects to other sites after login', () => {
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext('//evil.example')).toBe('/app');
    expect(safeNext('/\\evil.example')).toBe('/app');
  });
});

describe('loginPath', () => {
  it('encodes the return path so its own query string survives the round trip', () => {
    expect(loginPath('/board/a?x=1&y=2')).toBe('/login?next=%2Fboard%2Fa%3Fx%3D1%26y%3D2');
  });
});
