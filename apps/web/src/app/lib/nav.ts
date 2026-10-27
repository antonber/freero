/** Only allow same-app relative paths as post-login redirects (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** "/login?next=/board/abc" for the given target path. */
export function loginPath(target: string, page: 'login' | 'signup' = 'login'): string {
  return target && target !== '/' && target !== '/app' ? `/${page}?next=${encodeURIComponent(target)}` : `/${page}`;
}
