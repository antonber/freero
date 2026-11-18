import { useEffect, useRef, useState } from 'react';
import { definePanel, useElementsQuery, usePeers } from '@engine';
import { markNudgeShown, NUDGE_AFTER_MS, nudgeShown, shouldNudge } from './lib/nudge';
import { t } from './messages';

export default definePanel({
  id: 'share-nudge.panel',
  slot: 'screen-overlay',
  order: 50,
  Component: ({ editor }) => {
    const { host } = editor;
    const me = host.user.id;
    const mine = useElementsQuery(
      (els) => els.reduce((n, el) => (el.createdBy === me ? n + 1 : n), 0),
      (a, b) => a === b,
    );
    const othersHere = usePeers().some((p) => p.user.id !== me);
    const done = useRef(false);
    const [settled, setSettled] = useState(false);
    useEffect(() => {
      const timer = setTimeout(() => setSettled(true), NUDGE_AFTER_MS);
      return () => clearTimeout(timer);
    }, []);
    useEffect(() => {
      if (done.current) return;
      const state = {
        isOwner: host.board.role === 'owner',
        signedIn: host.board.signedIn !== false,
        shared: host.board.shared,
        othersHere,
        mine,
        settled,
        alreadyShown: nudgeShown(host.board.id),
      };
      if (!shouldNudge(state)) return;
      done.current = true;
      markNudgeShown(host.board.id);
      host.trackProduct?.({ name: 'share_nudge', action: 'shown' });
      host.notify(t('nudge'), 'info', {
        action: {
          label: t('invite'),
          run: () => {
            host.trackProduct?.({ name: 'share_nudge', action: 'clicked' });
            host.openShareDialog('nudge');
          },
        },
      });
    }, [host, mine, othersHere, settled]);
    return null;
  },
});
