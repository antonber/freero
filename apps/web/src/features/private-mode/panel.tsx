import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { PrivateModeSession } from '@freero/shared';
import { definePanel, useCanEdit, useCollection, useElements, type Editor } from '@engine';
import { Button } from '@ui';
import { COLLECTION, canManage, privateRule, revealAndEnd, shareLeftovers } from './lib/session';
import './private-mode.css';

function useSession(): PrivateModeSession | undefined {
  const entries = useCollection<PrivateModeSession>(COLLECTION);
  return useMemo(() => {
    const s = entries.find(([k]) => k === 'session')?.[1];
    return s?.active ? s : undefined;
  }, [entries]);
}

/** Session bar + the placement rule (what this user adds goes private while the session is on). */
function PrivateModeBar({ editor }: { editor: Editor }) {
  const session = useSession();
  const canEdit = useCanEdit();
  const elements = useElements();

  useEffect(() => {
    editor.setPrivatePlacement(session && canEdit ? privateRule(editor, session) : null);
    return () => editor.setPrivatePlacement(null);
  }, [editor, session, canEdit]);

  const mine = elements.filter((el) => editor.layerOf(el.id) === 'private').length;
  if (!session) return canEdit && mine > 0 ? <LeftoverBar editor={editor} count={mine} /> : null;
  const frame = session.frameId ? editor.getElement(session.frameId) : undefined;
  const where = frame && 'title' in frame && frame.title ? ` in “${frame.title}”` : frame ? ' in a frame' : '';
  const by = session.startedBy === editor.user.id ? 'you reveal' : `${session.startedByName || 'the facilitator'} reveals`;

  return (
    <div className="fr-private-bar" data-fr-interactive="" role="region" aria-label="Private mode">
      <span className="fr-private-bar__icon">
        <EyeOff size={16} />
      </span>
      <div className="fr-private-bar__text">
        <strong>Private mode{where}</strong>
        <span>
          {canEdit
            ? `What you add${where ? ' there' : ''} is visible only to you until ${by} it. Others don't see your cursor ${where ? 'there' : 'meanwhile'}.`
            : "Participants' notes appear here once they are revealed."}
        </span>
      </div>
      {canEdit && (
        <span className="fr-private-bar__count" title="Only you can see these until they are revealed">
          {mine} private item{mine === 1 ? '' : 's'}
        </span>
      )}
      {canManage(editor, session) && (
        <Button size="sm" variant="primary" icon={Eye} onClick={() => revealAndEnd(editor)}>
          Reveal all
        </Button>
      )}
    </div>
  );
}

/**
 * Private items with no private mode running: made in the moment the facilitator revealed (the
 * reveal could not include them). Shown after a moment, so it never flashes while the board loads.
 */
function LeftoverBar({ editor, count }: { editor: Editor; count: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 1500);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="fr-private-bar" data-fr-interactive="" role="region" aria-label="Private items">
      <span className="fr-private-bar__icon">
        <EyeOff size={16} />
      </span>
      <div className="fr-private-bar__text">
        <strong>
          {count} item{count === 1 ? ' is' : 's are'} still visible only to you
        </strong>
        <span>Private mode has ended. Share {count === 1 ? 'it' : 'them'} with everyone on the board?</span>
      </div>
      <Button size="sm" variant="primary" icon={Eye} onClick={() => shareLeftovers(editor)}>
        Share
      </Button>
    </div>
  );
}

export default definePanel({
  id: 'private-mode.bar',
  slot: 'top-center',
  order: 40,
  Component: PrivateModeBar,
});
