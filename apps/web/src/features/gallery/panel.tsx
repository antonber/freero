// "Publish to the community gallery" (#162): this board as a public template. The server copies
// only what everyone on the board sees (never comments, hidden frames, drafts, links to other
// boards, files or names) and holds it for review; this dialog collects the title, description,
// category, licence and credit, and lists the person's submissions with their status.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Globe } from 'lucide-react';
import { GALLERY_CATEGORIES, GALLERY_LIMITS, type GalleryCategory, type GalleryLicence, type GalleryStatus, type OwnGalleryTemplate } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, Input, Modal, SegmentedControl, Select, TextArea, Toggle } from '@ui';
import { t } from './messages';
import './gallery.css';

export const PUBLISH_DIALOG = 'gallery.publish';

const categoryLabel = (c: GalleryCategory): string =>
  ({
    brainstorming: t('catBrainstorming'),
    planning: t('catPlanning'),
    retrospectives: t('catRetrospectives'),
    meetings: t('catMeetings'),
    diagrams: t('catDiagrams'),
    research: t('catResearch'),
    strategy: t('catStrategy'),
    education: t('catEducation'),
    other: t('catOther'),
  })[c];

const statusLabel = (s: GalleryStatus): string => ({ pending: t('statusPending'), approved: t('statusApproved'), rejected: t('statusRejected'), removed: t('statusRemoved') })[s];

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : t('somethingWentWrong'));

function Submissions({ list, onWithdraw }: { list: OwnGalleryTemplate[]; onWithdraw(t: OwnGalleryTemplate): void }) {
  if (!list.length) return null;
  return (
    <section className="fr-gallery__mine" aria-label={t('yourSubmissions')}>
      <h3 className="fr-gallery__mine-title">{t('yourSubmissions')}</h3>
      <ul>
        {list.map((s) => (
          <li key={s.id} className="fr-gallery__row">
            <span className="fr-gallery__row-main">
              {s.status === 'approved' ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
              <span className={`fr-gallery__status fr-gallery__status--${s.status}`}>{statusLabel(s.status)}</span>
              {s.statusNote ? <span className="fr-gallery__note">{s.statusNote}</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => onWithdraw(s)}>
              {t('withdraw')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PublishDialog({ editor }: PanelProps) {
  const host = editor.host.gallery;
  const close = () => editor.closePanel(PUBLISH_DIALOG);
  const [title, setTitle] = useState(() => editor.host.board.title.slice(0, GALLERY_LIMITS.title));
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GalleryCategory>('brainstorming');
  const [licence, setLicence] = useState<GalleryLicence>('cc-by-4.0');
  const [author, setAuthor] = useState(() => editor.host.user.name.slice(0, GALLERY_LIMITS.author));
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<OwnGalleryTemplate[]>([]);

  const reload = useCallback(() => {
    host?.mine().then(setMine, () => setMine([]));
  }, [host]);
  useEffect(reload, [reload]);
  if (!host) return null;

  const ready = !!title.trim() && !!description.trim() && !!author.trim() && rights;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await host.submit({ title: title.trim(), description: description.trim(), category, licence, author: author.trim() });
      close();
      editor.host.notify(t('submittedForReview', { title: sent.title }), 'success');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (s: OwnGalleryTemplate) => {
    try {
      await host.withdraw(s.id);
      reload();
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : close}
      title={t('publishTitle')}
      description={t('publishIntro')}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="primary" icon={Globe} loading={busy} disabled={!ready} onClick={() => void submit()}>
            {t('submitForReview')}
          </Button>
        </>
      }
    >
      <form className="fr-gallery" onSubmit={submit} noValidate>
        <Input label={t('title')} autoFocus value={title} maxLength={GALLERY_LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
        <TextArea label={t('description')} rows={3} value={description} maxLength={GALLERY_LIMITS.description} placeholder={t('descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} />
        <div className="fr-gallery__pair">
          <label className="fr-gallery__label">
            <span>{t('category')}</span>
            <Select<GalleryCategory> aria-label={t('category')} value={category} onChange={setCategory} width="100%" options={GALLERY_CATEGORIES.map((c) => ({ value: c.id, label: categoryLabel(c.id) }))} />
          </label>
          <Input label={t('creditAs')} value={author} maxLength={GALLERY_LIMITS.author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="fr-gallery__label">
          <span>{t('licence')}</span>
          <SegmentedControl<GalleryLicence>
            aria-label={t('licence')}
            value={licence}
            onChange={setLicence}
            options={[
              { value: 'cc-by-4.0', label: t('licenceCcBy') },
              { value: 'cc0-1.0', label: t('licenceCc0') },
            ]}
          />
          <p className="fr-gallery__fine">{licence === 'cc0-1.0' ? t('cc0Explained') : t('ccByExplained')}</p>
        </div>
        <p className="fr-gallery__notice">{t('whatIsCopied')}</p>
        <Toggle checked={rights} onChange={setRights} label={t('iMayShareThis')} />
        {error && (
          <p className="fr-gallery__error" role="alert">
            {error}
          </p>
        )}
        <Submissions list={mine} onWithdraw={(s) => void withdraw(s)} />
      </form>
    </Modal>
  );
}

export default definePanel({ id: PUBLISH_DIALOG, slot: 'dialog', order: 70, minRole: 'editor', Component: PublishDialog });
