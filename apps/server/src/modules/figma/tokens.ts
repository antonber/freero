// A person's Figma tokens: sealed at rest (platform/secrets), refreshed when they are about to
// expire, and the connection dropped when Figma no longer accepts them.
import { seal, unseal } from '../../platform/secrets';
import { HttpError } from '../../platform/http';
import { logger } from '../../platform/log';
import { FigmaApiError, refreshTokens } from './api';
import * as repo from './repo';

const PURPOSE = 'figma-token-v1';
/** Refreshed this long before Figma's expiry, so a call never starts with a token about to lapse. */
const EARLY_MS = 60_000;

export const sealToken = (token: string) => seal(PURPOSE, token);

const reconnect = () => new HttpError(409, 'Connect Figma again: Figma no longer accepts Freero’s access to your account.', 'figma_reconnect');
export const notConnected = () => new HttpError(409, 'Connect your Figma account first.', 'figma_not_connected');

async function refreshed(userId: string, sealedRefresh: string | null): Promise<string> {
  const refresh = sealedRefresh ? unseal(PURPOSE, sealedRefresh)?.value : null;
  if (!refresh) {
    await repo.deleteAccount(userId);
    throw reconnect();
  }
  try {
    const t = await refreshTokens(refresh);
    await repo.setTokens(userId, sealToken(t.accessToken), t.refreshToken ? sealToken(t.refreshToken) : null, t.expiresAt);
    return t.accessToken;
  } catch (e) {
    if (!(e instanceof FigmaApiError)) throw e;
    if (e.status === 400 || e.status === 401 || e.status === 403) {
      // Revoked in Figma (or the app's secret changed): the connection is gone, say so once.
      logger.info({ figma: { dropped: 'refresh_refused' } }, 'figma connection dropped');
      await repo.deleteAccount(userId);
      throw reconnect();
    }
    throw new HttpError(502, 'Figma didn’t answer. Try again in a moment.', 'figma_unreachable');
  }
}

/**
 * Runs `fn` with the person's Figma access token. A token near its expiry is refreshed first; one
 * Figma refuses (401) is refreshed once and `fn` retried.
 */
export async function withFigmaToken<T>(userId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const acct = await repo.account(userId);
  if (!acct) throw notConnected();
  const opened = unseal(PURPOSE, acct.accessToken);
  let token = opened?.value ?? null;
  if (!token || (acct.expiresAt !== null && acct.expiresAt - EARLY_MS < Date.now())) token = await refreshed(userId, acct.refreshToken);
  else if (opened?.stale) await repo.setTokens(userId, sealToken(token), null, acct.expiresAt);
  try {
    return await fn(token);
  } catch (e) {
    if (!(e instanceof FigmaApiError) || e.status !== 401) throw e;
    return fn(await refreshed(userId, acct.refreshToken));
  }
}
