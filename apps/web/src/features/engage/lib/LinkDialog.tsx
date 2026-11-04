// "Answer link and QR code" (#40): the link people answer through on a phone, as a QR code to put
// on a slide or a screen, with copy / open, and (editors) whether the activity draws it too.
import { Copy, ExternalLink } from 'lucide-react';
import type { ActivityElement } from '@freero/shared';
import { useCanEdit, useElement, type PanelProps } from '@engine';
import { Button, Modal, Toggle } from '@ui';
import { LINK_DIALOG, answerLink } from './activity';
import { QrCode } from './qr';

import { t } from '../messages';
export function LinkDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const canEdit = useCanEdit();
  const close = () => editor.closePanel(LINK_DIALOG);
  if (!a || a.type !== 'activity') return null;
  const onServer = !!editor.host.engage;
  const link = answerLink(editor.boardId, a.id, onServer);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      editor.host.notify(t('answerLinkCopied'), 'success');
    } catch {
      editor.host.notify(t('couldnTCopySelectThe'), 'error');
    }
  };
  return (
    <Modal open onClose={close} title={t('answerOnAPhone')} width={420} footer={<Button variant="primary" onClick={close}>{t('done')}</Button>}>
      <div className="fr-engage-link">
        <QrCode className="fr-engage-link__qr" text={link} label={t('qrCodeOfTheAnswer')} />
        <p className="fr-engage-link__hint">
          {onServer
            ? 'Scan with a phone camera, or open the link. Anyone who can open the board answers there, without the board' + (a.guests ? ', visitors without an account too.' : '.')
            : t('thisBoardIsNotOn')}
        </p>
        <input className="fr-engage-link__url" readOnly value={link} aria-label={t('answerLink')} onFocus={(e) => e.currentTarget.select()} />
        <div className="fr-engage-link__actions">
          <Button icon={Copy} onClick={() => void copy()}>{t('copyLink')}</Button>
          <Button variant="ghost" icon={ExternalLink} onClick={() => window.open(link, '_blank', 'noopener')}>{t('open')}</Button>
        </div>
        {canEdit ? <Toggle label={t('showTheQrCodeOn')} checked={!!a.qr} onChange={(qr) => editor.update<ActivityElement>(a.id, { qr })} /> : null}
      </div>
    </Modal>
  );
}
