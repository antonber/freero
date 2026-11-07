import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { PRIVATE_MODE_TYPES, type PrivateModeSession } from '@freero/shared';
import { definePanel, useCanEdit, useCollection, useElements, useParticipant, type Editor } from '@engine';
import { Button, Toggle } from '@ui';
import { COLLECTION, canManage, privateRule, revealAndEnd, runningSession, setAnonymous, shareLeftovers } from './lib/session';
import { t as tr } from './messages';
import './private-mode.css';

function useSession(): PrivateModeSession | undefined {
  const entries = useCollection<PrivateModeSession>(COLLECTION);
  return useMemo(() => runningSession((key) => entries.find(([k]) => k === key)?.[1]), [entries]);
}

/** Session bar + the placement rule (what this user adds goes private while the session is on). */
function PrivateModeBar({ editor }: { editor: Editor }) {
  const session = useSession();
  const editable = useCanEdit();
  // A participant (commenter or guest taking part) drafts like an editor while the session runs.
  const participant = useParticipant();
  const canEdit = editable || participant;
  const elements = useElements();

  useEffect(() => {
    editor.setPrivatePlacement(session && canEdit ? privateRule(editor, session) : null, { types: PRIVATE_MODE_TYPES });
    return () => editor.setPrivatePlacement(null);
  }, [editor, session, canEdit]);

  const mine = elements.filter((el) => editor.layerOf(el.id) === 'private').length;
  if (!session) return editable && mine > 0 ? <LeftoverBar editor={editor} count={mine} /> : null;
  const frame = session.frameId ? editor.getElement(session.frameId) : undefined;
  const where = frame && 'title' in frame && frame.title ? ` in “${frame.title}”` : frame ? ' in a frame' : '';
  const by = session.startedBy === editor.user.id ? 'you reveal' : `${session.startedByName || 'the facilitator'} reveals`;
  // Everyone is told before they write whether their notes will carry their name (#44).
  const title = session.anonymous ? tr('anonymousPrivateMode') : tr('privateMode');

  return (
    <div className="fr-private-bar" data-fr-interactive="" role="region" aria-label={tr('privateMode')}>
      <span className="fr-private-bar__icon">
        <EyeOff size={16} />
      </span>
      <div className="fr-private-bar__text">
        <strong>
          {title}
          {where}
        </strong>
        <span>
          {canEdit
            ? tr('whatYouAddValueIs', { value: where ? tr('there') : '', by, value2: session.anonymous ? tr('withoutYourName') : '', value3: where ? tr('there2') : tr('meanwhile') })
            : tr('participantsNotesAppearHereOnce', { value: session.anonymous ? tr('withoutNames') : '' })}
        </span>
      </div>
      {canEdit && (
        <span className="fr-private-bar__count" title={tr('onlyYouCanSeeThese')}>{tr('minePrivateItems', { mine })}</span>
      )}
      {canManage(editor, session) && (
        <>
          <Toggle size="sm" label={tr('anonymous')} checked={!!session.anonymous} onChange={(on) => setAnonymous(editor, on)} />
          <Button size="sm" variant="primary" icon={Eye} onClick={() => revealAndEnd(editor)}>{tr('revealAll')}</Button>
        </>
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
    <div className="fr-private-bar" data-fr-interactive="" role="region" aria-label={tr('privateItems')}>
      <span className="fr-private-bar__icon">
        <EyeOff size={16} />
      </span>
      <div className="fr-private-bar__text">
        <strong>{tr('countItemsAreStillVisible', { count })}</strong>
        <span>{tr('privateModeHasEndedShare', { count })}</span>
      </div>
      <Button size="sm" variant="primary" icon={Eye} onClick={() => shareLeftovers(editor)}>{tr('share')}</Button>
    </div>
  );
}

export default definePanel({
  id: 'private-mode.bar',
  slot: 'top-center',
  order: 40,
  Component: PrivateModeBar,
});
