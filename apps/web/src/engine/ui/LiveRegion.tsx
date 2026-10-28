// Visually hidden live regions (interaction/announce.ts says what): one for the selection, one for
// collaborators, so news about other people never cuts the read-out of your own selection short.
import { useEffect, useState } from 'react';
import { useCore } from '../context';
import { installAnnouncer } from '../interaction/announce';

/** A region re-reads an identical message only when its text changes: alternate a trailing space. */
const fresh = (prev: string, next: string) => (prev === next ? `${next} ` : next);

export function LiveRegion() {
  const core = useCore();
  const [selection, setSelection] = useState('');
  const [people, setPeople] = useState('');
  useEffect(
    () =>
      installAnnouncer(core, {
        selection: (m) => setSelection((p) => fresh(p, m)),
        people: (m) => setPeople((p) => fresh(p, m)),
      }),
    [core],
  );
  return (
    <>
      <div className="fr-sr-only" role="status" aria-live="polite" aria-atomic="true" data-fr-live="selection">
        {selection}
      </div>
      <div className="fr-sr-only" role="log" aria-live="polite" aria-atomic="true" data-fr-live="people">
        {people}
      </div>
    </>
  );
}
