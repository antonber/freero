// Per-request context (request id, authenticated user) that follows async work, so logs, metrics,
// rate limits and error reports can attribute a request without modules passing it around.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface RequestContext {
  reqId: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();
const byRequest = new WeakMap<IncomingMessage, RequestContext>();

const INCOMING_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** Creates the context for a request (honouring a well-formed X-Request-Id from the proxy). */
export function createRequestContext(req: IncomingMessage): RequestContext {
  const incoming = req.headers['x-request-id'];
  const reqId = typeof incoming === 'string' && INCOMING_ID_RE.test(incoming) ? incoming : randomUUID();
  const ctx: RequestContext = { reqId, userId: null };
  byRequest.set(req, ctx);
  return ctx;
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requestContextOf(req: IncomingMessage): RequestContext | undefined {
  return byRequest.get(req);
}

/** Auth calls this once it knows who is asking; logs and per-user rate limits use it. */
export function setRequestUser(req: IncomingMessage, userId: string): void {
  const ctx = byRequest.get(req);
  if (ctx) ctx.userId = userId;
}

/** The authenticated user of a request, if auth has identified one. */
export function requestUserId(req: IncomingMessage): string | null {
  return byRequest.get(req)?.userId ?? null;
}
