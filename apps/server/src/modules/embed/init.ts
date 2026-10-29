// Kill switches reach live board views (ws.ts) the way they reach sessions (auth's re-check): every
// instance, every SESSION_RECHECK_SECONDS, re-checks the views behind ITS sockets — the credential
// still there and not paused, the account in good standing, the team's API switch on and the app
// not blocked — and closes the ones that may no longer stay open. A view also closes when its
// token expires (ws.ts); opening one again goes through the assistant, i.e. a fresh tool call.
import type { ServerContext } from '../../platform/context';
import { HttpError } from '../../platform/http';
import { log, logError } from '../../platform/log';
import { authenticateEmbedKey, EMBED_SESSION_PREFIX, useInWorkspace } from '../apiauth/index';
import { boardWorkspaceId } from '../boards/index';
import { endSessionSockets, liveSessionKeys } from '../realtime/index';

/** The views behind this instance's sockets that must close now. */
export async function viewsToClose(): Promise<string[]> {
  const keys = new Set([...liveSessionKeys()].filter((k) => k.startsWith(EMBED_SESSION_PREFIX)));
  const gone: string[] = [];
  for (const key of keys) {
    // A database hiccup throws out of here (the next round tries again); only a real "no" closes.
    const session = await authenticateEmbedKey(key);
    if (!session) {
      gone.push(key);
      continue;
    }
    const workspaceId = await boardWorkspaceId(session.boardId);
    try {
      if (workspaceId) await useInWorkspace(session.cred, workspaceId);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      gone.push(key);
    }
  }
  return gone;
}

export default function initEmbed(ctx: ServerContext): void {
  let running: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    running = running.then(viewsToClose).then(
      (keys) => {
        for (const key of keys) endSessionSockets(key);
        if (keys.length) log(`embed: closed ${keys.length} live board view(s) whose connection was revoked or turned off`);
      },
      (e) => logError('embed: could not re-check live board views', e),
    );
  }, ctx.config.sessionRecheckMs);
  timer.unref();
  ctx.onShutdown(async () => {
    clearInterval(timer);
    await running;
  });
}
