// Playback is each viewer's own (never synced), so it lives in the item's component. The live
// (on-screen) components register how to play / pause here, for the Space key on a selected item.
const players = new Map<string, () => void>();

export function registerPlayer(id: string, toggle: () => void): () => void {
  players.set(id, toggle);
  return () => {
    if (players.get(id) === toggle) players.delete(id);
  };
}

/** Plays or pauses the item's player; false when it has none on screen. */
export function togglePlayer(id: string): boolean {
  const toggle = players.get(id);
  toggle?.();
  return !!toggle;
}
