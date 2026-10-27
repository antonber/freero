import { describe, expect, it } from 'vitest';
import { hitLimit, MemoryStore } from './rateLimit';

describe('rate limit windows', () => {
  it('blocks the hit after the limit, tells when to retry, and lets the client back in after the window', async () => {
    const store = new MemoryStore();
    const rule = { limit: 3, windowMs: 60_000 };
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect((await hitLimit(store, 'ip:1', rule, t0 + i)).allowed).toBe(true);
    const blocked = await hitLimit(store, 'ip:1', rule, t0 + 20_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBe(40); // seconds until the window that started at t0 ends
    expect((await hitLimit(store, 'ip:1', rule, t0 + 60_000)).allowed).toBe(true);
  });

  it("one client exhausting its limit does not block another client's key", async () => {
    const store = new MemoryStore();
    const rule = { limit: 1, windowMs: 60_000 };
    await hitLimit(store, 'email:a', rule, 0);
    expect((await hitLimit(store, 'email:a', rule, 1)).allowed).toBe(false);
    expect((await hitLimit(store, 'email:b', rule, 1)).allowed).toBe(true);
  });
});
