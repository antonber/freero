// Beside the board's title (#158): its classification label for everyone on the board, and — for
// the people who manage its label — what the workspace's sensitive-data scan found on it, with the
// label the workspace suggests (one click gives it) or the note that it was required. The server
// scans, decides and enforces; this only shows it.
import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { BoardSensitiveData, BoardSummary, SensitiveDataKind } from '@freero/shared';
import { Button, formatList, Popover, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { t } from '../messages';
import { LabelBadge } from './BoardLabelPicker';
import './BoardLabelPicker.css';

const KIND: Record<SensitiveDataKind, string> = {
  payment_card: t('sensitive.kind.paymentCard'),
  iban: t('sensitive.kind.iban'),
  national_id: t('sensitive.kind.nationalId'),
  secret: t('sensitive.kind.secret'),
  email: t('sensitive.kind.email'),
  phone: t('sensitive.kind.phone'),
};

export function BoardClassification({ board, onBoardChange }: { board: BoardSummary; onBoardChange: (b: BoardSummary) => void }) {
  const notify = useToast();
  const manages = board.permissions.manageSharing ?? board.role === 'owner';
  const [found, setFound] = useState<BoardSensitiveData | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!manages) return;
    api.boardSensitiveData(board.id).then(setFound, () => setFound(null));
  }, [board.id, board.label?.id, manages]);

  const give = async (labelId: string) => {
    setBusy(true);
    try {
      onBoardChange((await api.setBoardLabel(board.id, labelId)).board);
      setOpen(false);
    } catch (e) {
      notify(e instanceof ApiError && e.status < 500 ? e.message : t('sensitive.couldNotLabel'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const kinds = found?.kinds ?? [];
  if (!board.label && !kinds.length) return null;
  return (
    <span className="fr-board-classification">
      {board.label ? <LabelBadge label={board.label} /> : null}
      {kinds.length ? (
        <>
          <button ref={chip} type="button" className="fr-sensitive-chip" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
            <ShieldAlert size={13} aria-hidden />
            {t('sensitive.chip')}
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchor={chip.current} side="bottom" align="start" width={300}>
            <div className="fr-sensitive-pop" role="dialog" aria-label={t('sensitive.chip')}>
              <p className="fr-sensitive-pop__text">{t('sensitive.foundOnBoard', { kinds: formatList(kinds.map((k) => KIND[k])) })}</p>
              {found?.label ? (
                found.action === 'require' ? (
                  <p className="fr-sensitive-pop__text">{t('sensitive.requiredLabel', { label: found.label.name })}</p>
                ) : (
                  <Button size="sm" variant="primary" loading={busy} onClick={() => void give(found.label!.id)}>
                    {t('sensitive.giveLabel', { label: found.label.name })}
                  </Button>
                )
              ) : found?.action !== 'notify' ? (
                <p className="fr-sensitive-pop__text">{t('sensitive.labelledEnough')}</p>
              ) : (
                <p className="fr-sensitive-pop__text">{t('sensitive.adminsTold')}</p>
              )}
            </div>
          </Popover>
        </>
      ) : null}
    </span>
  );
}
