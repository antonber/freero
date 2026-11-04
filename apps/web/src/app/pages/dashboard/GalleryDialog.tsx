// A community template opened from the public gallery (#162): /app?gallery=<id> (the public page's
// "Use this template", after signing in) shows it with its author and licence and adds a copy to
// the workspace open here; `&report=1` (the page's "Report this template") opens the report form.
// The server answers 404 for anything not public, which reads here as "not available".
import { useEffect, useState } from 'react';
import { Flag, Plus } from 'lucide-react';
import { GALLERY_LICENCES, MAX_REPORT_NOTE, REPORT_REASONS, type GalleryTemplate, type ReportReason } from '@freero/shared';
import { Button, Modal, Spinner, TextArea, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { t as tr } from './messages';
import './gallery.css';

const message = (e: unknown) => (e instanceof ApiError ? e.message : tr('gallerySomethingWentWrong'));

export function GalleryDialog({
  id,
  startReporting,
  workspace,
  onClose,
  onInstalled,
}: {
  id: string;
  startReporting: boolean;
  workspace: { id: string; label: string };
  onClose(): void;
  onInstalled(boardId: string): void;
}) {
  const notify = useToast();
  const [t, setT] = useState<GalleryTemplate | null>(null);
  const [reporting, setReporting] = useState(startReporting);
  const [reason, setReason] = useState<ReportReason>('copyright');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.galleryTemplate(id).then(
      (r) => live && setT(r.template),
      () => {
        if (!live) return;
        notify(tr('galleryNotAvailable'), 'error');
        onClose();
      },
    );
    return () => {
      live = false;
    };
  }, [id, notify, onClose]);

  const install = async () => {
    setBusy(true);
    try {
      const { boardId } = await api.installGalleryTemplate(id, workspace.id);
      onInstalled(boardId);
    } catch (e) {
      notify(message(e), 'error');
      setBusy(false);
    }
  };
  const report = async () => {
    setBusy(true);
    try {
      await api.reportGalleryTemplate(id, reason, note.trim());
      notify(tr('galleryReportSent'), 'success');
      onClose();
    } catch (e) {
      notify(message(e), 'error');
      setBusy(false);
    }
  };

  const licence = t ? (GALLERY_LICENCES.find((l) => l.id === t.licence) ?? GALLERY_LICENCES[0]) : null;
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={reporting ? tr('galleryReportTitle') : (t?.title ?? tr('galleryCommunityTemplate'))}
      width={560}
      footer={
        !t ? undefined : reporting ? (
          <>
            <Button variant="secondary" onClick={() => (startReporting ? onClose() : setReporting(false))} disabled={busy}>
              {tr('galleryCancel')}
            </Button>
            <Button variant="danger" icon={Flag} loading={busy} onClick={() => void report()}>
              {tr('gallerySendReport')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={Flag} onClick={() => setReporting(true)} disabled={busy}>
              {tr('galleryReport')}
            </Button>
            <Button variant="primary" icon={Plus} loading={busy} onClick={() => void install()}>
              {tr('galleryAddTo', { workspace: workspace.label })}
            </Button>
          </>
        )
      }
    >
      {!t || !licence ? (
        <div className="fr-dash-gallery__loading">
          <Spinner size={20} />
        </div>
      ) : reporting ? (
        <div className="fr-dash-gallery">
          <p className="fr-dash-gallery__by">{t.title}</p>
          <fieldset className="fr-dash-gallery__reasons">
            <legend>{tr('galleryWhatIsWrong')}</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.id}>
                <input type="radio" name="fr-dash-gallery-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} /> {r.label}
              </label>
            ))}
          </fieldset>
          <TextArea label={tr('galleryDetails')} value={note} maxLength={MAX_REPORT_NOTE} rows={3} onChange={(e) => setNote(e.target.value)} />
        </div>
      ) : (
        <div className="fr-dash-gallery">
          {/* The signed-in route: served by the API (the public picture lives on the marketing site's paths). */}
          <img className="fr-dash-gallery__preview" src={`/api/gallery/${encodeURIComponent(t.id)}/preview.svg`} alt={tr('galleryPreviewOf', { title: t.title })} />
          <p className="fr-dash-gallery__by">{tr('galleryByAuthor', { author: t.author, licence: licence.name })}</p>
          {/* The submitter's words: plain text, never markup. */}
          <p className="fr-dash-gallery__description">{t.description}</p>
          <p className="fr-dash-gallery__fine">{t.licence === 'cc0-1.0' ? tr('galleryCc0') : tr('galleryCcBy', { author: t.author })}</p>
        </div>
      )}
    </Modal>
  );
}
