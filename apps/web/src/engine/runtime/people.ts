// Who's who on this board (KAI-201): current profiles (name, color, photo) for user ids that board
// content names — comment authors, @mentions, assignees. One directory per board session, shared
// by every feature (comments and find show the same name for the same person): presence carries
// everyone online's current profile, and other ids are looked up through Host.lookupUsers (which
// also answers for people who wrote here and then left). Ids the server doesn't answer (deleted
// accounts) stay unknown, so readers fall back to what the content stored.
import { createStore, type StoreApi } from 'zustand';
import type { HostUser } from '../api';
import type { EngineCore } from './core';

export interface PeopleDirectory {
  people: StoreApi<Record<string, HostUser>>;
  /**
   * Ids the lookup answered WITHOUT (accounts that no longer exist, or people the board doesn't
   * show): readers say "Deleted user" for them instead of waiting forever. Grows only.
   */
  gone: StoreApi<ReadonlySet<string>>;
  /** Asks for the ids not known yet (batched over one tick; each id asked once). */
  request(ids: Iterable<string>): void;
}

const directories = new WeakMap<EngineCore, PeopleDirectory>();

export function peopleDirectory(core: EngineCore): PeopleDirectory {
  const existing = directories.get(core);
  if (existing) return existing;
  const me = core.hostRef.current.user;
  const people = createStore<Record<string, HostUser>>(() => ({ [me.id]: me }));
  const gone = createStore<ReadonlySet<string>>(() => new Set());
  const requested = new Set([me.id]);
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const remember = (users: HostUser[]) => {
    const cur = people.getState();
    const changed = users.filter((u) => {
      const c = cur[u.id];
      return !c || c.name !== u.name || c.color !== u.color || c.avatarUrl !== u.avatarUrl;
    });
    if (changed.length) people.setState(Object.fromEntries(changed.map((u) => [u.id, u])));
  };
  const fromPresence = () => remember(core.store.getPeers().map((p) => ({ ...p.user, avatarUrl: p.user.avatarUrl ?? null })));
  core.emitter.on('presence', fromPresence);
  fromPresence();

  const dir: PeopleDirectory = {
    people,
    gone,
    request(ids) {
      for (const id of ids) if (id && !requested.has(id)) (requested.add(id), pending.add(id));
      if (!pending.size || timer) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = [...pending];
        pending.clear();
        core.hostRef.current.lookupUsers(batch).then(
          (users) => {
            remember(users);
            const answered = new Set(users.map((u) => u.id));
            const missing = batch.filter((id) => !answered.has(id) && !people.getState()[id]);
            if (missing.length) gone.setState(new Set([...gone.getState(), ...missing]), true);
          },
          () => batch.forEach((id) => requested.delete(id)), // asked again next time they render
        );
      }, 0);
    },
  };
  directories.set(core, dir);
  return dir;
}
