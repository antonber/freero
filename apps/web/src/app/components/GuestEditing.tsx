// Guest editing in the share dialog (#97, @freero/shared guestEditing.ts): the owner or a co-owner
// lets guests on the board's "can edit" link edit (off by default), sees who joined and what each
// added, removes everything one added in one step, removes a guest, and can report one to the
// operator's moderators. The server enforces all of it; this only shows and asks.
import { useCallback, useEffect, useState } from 'react';
import { Eraser, UserRound, UserX } from 'lucide-react';
import type { BoardGuest, BoardSummary, LinkAccess, ReportReason } from '@freero/shared';
import { Button, Modal, Select, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';
import { t } from '../messages';

type Pending = { kind: 'undo' | 'remove'; guest: BoardGuest };

const REASONS: Array<SelectOption<ReportReason | ''>> = [
  { value: '', label: t('guestsDontReport') },
  { value: 'spam', label: t('guestsReportSpam') },
  { value: 'harassment', label: t('guestsReportHarassment') },
  { value: 'other', label: t('guestsReportOther') },
];

export function GuestEditing({ board, linkAccess, onChange }: { board: BoardSummary; linkAccess: LinkAccess; onChange: (b: BoardSummary) => void }) {
  const notify = useToast();
  const manages = board.permissions.manageSharing ?? board.role === 'owner';
  const allowed = board.permissions.guestEditing === true && board.permissions.guestLinks === true;
  const on = board.sharing?.guestsCanEdit === true;
  const [busy, setBusy] = useState(false);
  const [guests, setGuests] = useState<BoardGuest[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState<ReportReason | ''>('');

  const load = useCallback(() => {
    api
      .boardGuests(board.id)
      .then((r) => setGuests(r.guests))
      .catch(() => setGuests([]));
  }, [board.id]);
  // Only where guests may edit (or the board still says they do): nothing to manage elsewhere.
  const relevant = manages && board.kind === 'board' && (allowed || on);
  useEffect(() => {
    if (relevant) load();
  }, [relevant, load]);

  if (!relevant) return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const { board: updated } = await api.updateBoard(board.id, { sharing: { guestsCanEdit: next } });
      onChange(updated);
      notify(next ? t('guestsOnTheLinkCanNowEdit') : t('guestsOnTheLinkCanOnlyComment'), 'success');
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t('couldNotChangeTheSharing'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const { kind, guest } = pending;
    setBusy(true);
    try {
      if (kind === 'undo') {
        const { removed } = await api.undoGuestEdits(board.id, guest.id);
        notify(t('removedItemsAGuestAdded', { count: removed, name: guest.name }), 'success');
      } else {
        await api.removeBoardGuest(board.id, guest.id);
        notify(t('guestRemovedFromBoard', { name: guest.name }), 'success');
      }
      // Reported to the operator's moderators (modules/moderation) as a report about this board.
      if (reason)
        await api
          .report({ boardId: board.id, target: { kind: 'board' }, reason, note: t('guestReportNote', { name: guest.name, id: guest.id, items: guest.items }) })
          .then(() => notify(t('guestReportSent'), 'success'))
          .catch((e) => notify(e instanceof ApiError ? e.message : t('guestReportFailed'), 'error'));
      setPending(null);
      setReason('');
      load();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t('guestActionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const needsEditLink = !on && linkAccess !== 'editor';
  return (
    <section className="fr-share__settings fr-share-guests" aria-label={t('guestsWithoutAnAccount')}>
      <h3 className="fr-share__heading">
        <UserRound size={14} aria-hidden /> {t('guestsWithoutAnAccount')}
      </h3>
      <Toggle size="sm" label={t('guestsOnTheLinkCanEdit')} checked={on} disabled={busy || (!on && (needsEditLink || !allowed))} onChange={(v) => void toggle(v)} />
      <p className="fr-share__settings-note">
        {!allowed && !on ? t('guestEditingIsOffIn') : needsEditLink ? t('setTheLinkToCanEdit') : t('guestsAddStickiesShapesText')}
      </p>
      {guests && guests.length > 0 ? (
        <ul className="fr-share-guests__list" aria-label={t('guestsOnThisBoard')}>
          {guests.map((g) => (
            <li key={g.id} className="fr-share-guests__row">
              <span className="fr-share-guests__dot" style={{ background: g.color ?? 'var(--fr-line-strong)' }} aria-hidden />
              <span className="fr-share-guests__who">
                <span className="fr-share__name">{t('guestNameLabel', { name: g.name || '…' })}</span>
                <span className="fr-share__email-text">
                  {g.removed ? t('guestStatusRemoved', { count: g.items }) : g.online ? t('guestStatusOnline', { count: g.items }) : t('guestStatusItems', { count: g.items })}
                </span>
              </span>
              <span className="fr-share__member-actions">
                {g.items > 0 ? (
                  <Button size="sm" variant="ghost" icon={Eraser} disabled={busy} onClick={() => setPending({ kind: 'undo', guest: g })}>
                    {t('removeWhatTheyAdded')}
                  </Button>
                ) : null}
                {g.active ? (
                  <Button size="sm" variant="ghost" icon={UserX} disabled={busy} onClick={() => setPending({ kind: 'remove', guest: g })}>
                    {t('removeGuest')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'undo' ? t('removeEverythingNameAdded', { name: pending.guest.name }) : t('removeNameFromThisBoard', { name: pending?.guest.name ?? '' })}
        width={420}
        footer={
          <>
            <Button onClick={() => setPending(null)}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => void confirm()}>
              {pending?.kind === 'undo' ? t('removeItems', { count: pending.guest.items }) : t('removeGuest')}
            </Button>
          </>
        }
      >
        <p className="fr-share__settings-note">{pending?.kind === 'undo' ? t('everythingThisGuestAddedIs') : t('theirSessionEndsNow')}</p>
        <div className="fr-share-guests__report">
          <span className="fr-share__email-text">{t('alsoReportToModerators')}</span>
          <Select<ReportReason | ''> aria-label={t('alsoReportToModerators')} size="sm" options={REASONS} value={reason} onChange={setReason} width={200} />
        </div>
      </Modal>
    </section>
  );
}
