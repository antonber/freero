// The board's room on the operator's Jitsi deployment (#149), through Jitsi's IFrame API
// (Apache-2.0), loaded from that deployment (https://<domain>/external_api.js; the server's CSP
// allows exactly that origin). Jitsi draws its own meeting (cameras, mute, screen sharing) inside
// its frame; with JITSI_APP_ID / JITSI_APP_SECRET the room only opens with the JWT Freero minted.
import { useEffect, useRef } from 'react';
import type { BoardCallToken } from '@freero/shared';
import { t } from '../messages';

type JitsiToken = Extract<BoardCallToken, { provider: 'jitsi' }>;

interface JitsiApi {
  addListener(event: string, fn: () => void): void;
  dispose(): void;
}
type JitsiCtor = new (domain: string, options: Record<string, unknown>) => JitsiApi;

const loading = new Map<string, Promise<JitsiCtor>>();

/** The deployment's IFrame API, loaded once per domain. */
function loadApi(domain: string): Promise<JitsiCtor> {
  let p = loading.get(domain);
  if (!p) {
    p = new Promise<JitsiCtor>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://${domain}/external_api.js`;
      s.async = true;
      s.onload = () => {
        const ctor = (window as unknown as { JitsiMeetExternalAPI?: JitsiCtor }).JitsiMeetExternalAPI;
        if (ctor) resolve(ctor);
        else reject(new Error('no JitsiMeetExternalAPI'));
      };
      s.onerror = () => reject(new Error('could not load'));
      document.head.appendChild(s);
    });
    p.catch(() => loading.delete(domain));
    loading.set(domain, p);
  }
  return p;
}

export function JitsiCall({ token, onLeave, onError }: { token: JitsiToken; onLeave: () => void; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;
  const fail = useRef(onError);
  fail.current = onError;

  useEffect(() => {
    let api: JitsiApi | null = null;
    let gone = false;
    loadApi(token.domain).then(
      (Ctor) => {
        if (gone || !host.current) return;
        api = new Ctor(token.domain, {
          roomName: token.room,
          ...(token.jwt ? { jwt: token.jwt } : {}),
          parentNode: host.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName: token.displayName },
          configOverwrite: { prejoinPageEnabled: false, prejoinConfig: { enabled: false }, disableDeepLinking: true },
        });
        api.addListener('readyToClose', () => leave.current());
      },
      () => !gone && fail.current(t('couldNotReachTheCall')),
    );
    return () => {
      gone = true;
      api?.dispose();
    };
  }, [token.domain, token.room, token.jwt, token.displayName]);

  return <div ref={host} className="fr-call-dock__jitsi" />;
}
