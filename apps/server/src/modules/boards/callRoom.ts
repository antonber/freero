// Calls docked on the board (#149): the operator's own LiveKit or Jitsi server (config.boardCalls)
// carries the audio and video; Freero only decides who may join which room. The room is derived
// from the board id with the server's secret (like the Jitsi link of KAI-134), so knowing a board's
// id tells nobody its room, and a token minted here opens that board's room and no other. Only
// someone who can open the board (guests too) gets one; their access is checked by the caller.
import { createHmac } from 'node:crypto';
import type { BoardCallProvider, BoardCallToken } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { mac } from '../../platform/secrets';

/** How long a token lets someone (re)join the room. A longer call outlives it; reconnecting asks again. */
export const CALL_TOKEN_TTL_S = 6 * 60 * 60;

export const dockedCalls = (): BoardCallProvider | null => getConfig().boardCalls?.provider ?? null;

/** The board's room on the media server: not guessable from the board id without the server's secret. */
export const callRoom = (boardId: string): string => `freero-${mac(`boards.call-room:${boardId}`).toString('hex').slice(0, 32)}`;

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** A compact HS256 JWT (what LiveKit access tokens and Jitsi's token authentication both are). */
export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(sig)}`;
}

/**
 * What `who` needs to join `boardId`'s room, or null when the operator configured no media server.
 * The caller has checked that `who` may open the board.
 */
export function callToken(boardId: string, who: { id: string; name: string; avatarUrl?: string | null }, now = Date.now()): BoardCallToken | null {
  const calls = getConfig().boardCalls;
  if (!calls) return null;
  const room = callRoom(boardId);
  const iat = Math.floor(now / 1000);
  const exp = iat + CALL_TOKEN_TTL_S;
  if (calls.provider === 'livekit') {
    // LiveKit's access token: the API key as issuer, the identity as subject, one room's grant.
    const token = signJwt(
      {
        iss: calls.apiKey,
        sub: who.id,
        name: who.name,
        nbf: iat - 10,
        iat,
        exp,
        video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
        metadata: JSON.stringify({ boardId }),
      },
      calls.apiSecret,
    );
    return { provider: 'livekit', url: calls.url, room, token, identity: who.id, expiresAt: exp * 1000 };
  }
  // Jitsi with token authentication (prosody mod_auth_token): app id as issuer and audience.
  const jwt =
    calls.appId && calls.appSecret
      ? signJwt(
          {
            iss: calls.appId,
            aud: calls.appId,
            sub: calls.domain,
            room,
            nbf: iat - 10,
            iat,
            exp,
            context: { user: { id: who.id, name: who.name, ...(who.avatarUrl?.startsWith('https://') ? { avatar: who.avatarUrl } : {}) } },
          },
          calls.appSecret,
        )
      : null;
  return { provider: 'jitsi', domain: calls.domain, room, jwt, displayName: who.name, expiresAt: exp * 1000 };
}
