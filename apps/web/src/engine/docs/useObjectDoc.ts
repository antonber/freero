// [additive, KAI-162 / KAI-152] Opening another object's document: one Yjs doc and one socket per
// object (`<syncUrl>/<id>`), created when a component needs it and closed when it unmounts — so a
// board with doc items connects only for the items on screen (off-screen elements are unmounted).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Role } from '@freero/shared';
import { ObjectDocStore, type DocPeer } from '../store/ObjectDocStore';
import type { ConnectionStatus } from '../store/BoardStore';
import { docThreads, type DocThread } from './comments';

export type { ObjectDocStore, DocPeer };

/**
 * The document of object `id` (null while `id` is null). `syncUrl`: the host's socket prefix for
 * that kind of object (Host.docs.syncUrl); '' with `initialState`: a local, read-only copy (a
 * version preview) that never connects.
 */
export function useObjectDoc(id: string | null, syncUrl: string, initialState?: Uint8Array): ObjectDocStore | null {
  const [store, setStore] = useState<ObjectDocStore | null>(null);
  useEffect(() => {
    if (!id) return;
    const s = new ObjectDocStore({ id, syncUrl, initialState });
    setStore(s);
    return () => {
      setStore(null);
      s.destroy();
    };
  }, [id, syncUrl, initialState]);
  return store;
}

export interface ObjectDocState {
  status: ConnectionStatus;
  synced: boolean;
  /** What the server says this person may do in the doc (null until it said). */
  role: Role | null;
  peers: DocPeer[];
  threads: DocThread[];
}

const EMPTY: ObjectDocState = { status: 'connecting', synced: false, role: null, peers: [], threads: [] };
const noop = () => () => {};

/** Live status, role, people and comment threads of an open document. */
export function useObjectDocState(doc: ObjectDocStore | null): ObjectDocState {
  const version = useSyncExternalStore(doc ? doc.subscribe : noop, doc ? doc.getVersion : () => 0);
  return useMemo(() => {
    if (!doc) return EMPTY;
    return { status: doc.status, synced: doc.synced, role: doc.serverRole, peers: doc.peers(), threads: docThreads(doc.commentEntries()) };
    // `version` changes whenever any of these does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, version]);
}
