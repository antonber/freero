import { useEffect, useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { PrivateModeSession } from '@freero/shared';
import { definePanel, useCanEdit, useCollection, useElements, type Editor } from '@engine';
import { Button } from '@ui';
import { COLLECTION, canManage, privateRule, revealAndEnd } from './lib/session';
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

  if (!session) return null;
  const frame = session.frameId ? editor.getElement(session.frameId) : undefined;
  const where = frame && 'title' in frame && frame.title ? ` in “${frame.title}”` : frame ? ' in a frame' : '';
  const mine = elements.filter((el) => editor.layerOf(el.id) === 'private').length;
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
            ? `What you add${where ? ' there' : ''} is visible only to you until ${by} it.`
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

export default definePanel({
  id: 'private-mode.bar',
  slot: 'top-center',
  order: 40,
  Component: PrivateModeBar,
});
