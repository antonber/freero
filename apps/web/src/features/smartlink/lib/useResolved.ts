// A smart link's target as THIS viewer may see it, asked from the server each time a chip mounts
// (the host batches the chips of a board into one request and keeps answers briefly).
import { useEffect, useState } from 'react';
import type { ObjectSummary } from '@freero/shared';
import type { Editor } from '@engine';

export type Resolved =
  | { state: 'loading' }
  | { state: 'ok'; object: ObjectSummary }
  /** No access, or no such object: the server tells them apart for nobody. */
  | { state: 'unavailable' }
  /** Not reachable right now (offline sandbox, network): the address is shown as is. */
  | { state: 'offline' };

export function useResolvedObject(editor: Editor | null, uri: string, enabled: boolean): Resolved {
  const [res, setRes] = useState<Resolved>({ state: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    const resolve = editor?.host.resolveObjects;
    if (!resolve) {
      setRes({ state: 'offline' });
      return;
    }
    let live = true;
    setRes({ state: 'loading' });
    resolve([uri]).then(
      ([r]) => live && setRes(r?.status === 'ok' ? { state: 'ok', object: r.object } : { state: 'unavailable' }),
      () => live && setRes({ state: 'offline' }),
    );
    return () => {
      live = false;
    };
  }, [editor, uri, enabled]);
  return res;
}
