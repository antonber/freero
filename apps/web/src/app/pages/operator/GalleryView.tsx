// The operator console's "Templates" view (#162): boards submitted to the community template
// gallery. Each card shows the preview drawn from the copy the server made (only the board's shared
// content), what the submitter wrote (plain text) and the licence; approving makes it public at
// /gallery, removing takes it down everywhere at once. Decisions go through the console's action
// dialog like every other: recorded, audited, emailed.
import { useEffect, useState } from 'react';
import { Check, ExternalLink, ShieldCheck, UserX, X } from 'lucide-react';
import { GALLERY_CATEGORIES, GALLERY_LICENCES, type GalleryForReview, type GalleryStatus, type ModerationActionKind, type ReportReason } from '@freero/shared';
import { Button, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { t as tr } from './messages';

export interface GalleryAct {
  action: ModerationActionKind;
  targetId: string;
  targetLabel: string;
  reason: ReportReason;
}

const STATUS_CHIP: Record<GalleryStatus, { tone: 'danger' | 'warn' | 'muted' | 'ok'; label: string }> = {
  pending: { tone: 'warn', label: tr('waitingForReview') },
  approved: { tone: 'ok', label: tr('galleryPublic') },
  rejected: { tone: 'muted', label: tr('declined') },
  removed: { tone: 'danger', label: tr('removed') },
};

function GalleryCard({ t, onAct }: { t: GalleryForReview; onAct: (a: GalleryAct) => void }) {
  const act = (action: ModerationActionKind) => onAct({ action, targetId: t.id, targetLabel: tr('theTemplateName', { name: t.title }), reason: 'other' });
  const chip = STATUS_CHIP[t.status];
  return (
    <article className="fr-op-card" data-testid="gallery-review">
      <div className="fr-op-card__head">
        <span className="fr-op-chip fr-op-chip--muted">{GALLERY_CATEGORIES.find((c) => c.id === t.category)?.label ?? t.category}</span>
        <h2 className="fr-op-card__board">{t.title}</h2>
        <span className={`fr-op-chip fr-op-chip--${chip.tone}`}>{chip.label}</span>
        {t.openReports > 0 && <span className="fr-op-chip fr-op-chip--danger">{tr('openreportsOpenReports', { openReports: t.openReports })}</span>}
        <span className="fr-op-card__when" title={new Date(t.createdAt).toLocaleString()}>
          {relativeTime(t.createdAt, Date.now())}
        </span>
      </div>
      {/* The server drew it from the template's own copy: the same picture the public page shows. */}
      <img className="fr-op-gallery__preview" src={t.previewUrl} alt={tr('previewOfName', { name: t.title })} loading="lazy" />
      <dl className="fr-op-card__facts">
        <dt>{tr('submittedBy')}</dt>
        <dd>{t.submitter ? `${t.submitter.name} <${t.submitter.email}>` : tr('aDeletedAccount')}</dd>
        <dt>{tr('galleryCredit')}</dt>
        <dd>{t.author}</dd>
        <dt>{tr('galleryLicence')}</dt>
        <dd>{GALLERY_LICENCES.find((l) => l.id === t.licence)?.name ?? t.licence}</dd>
        <dt>{tr('galleryItems')}</dt>
        <dd>{t.items}</dd>
        {t.statusNote && (
          <>
            <dt>{tr('lastDecision')}</dt>
            <dd>{t.statusNote}</dd>
          </>
        )}
      </dl>
      <blockquote className="fr-op-card__message">{t.description}</blockquote>
      <div className="fr-op-card__actions">
        {t.status === 'approved' && (
          <a className="fr-op-btnlink" href={t.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} aria-hidden /> {tr('galleryPublicPage')}
          </a>
        )}
        {(t.status === 'pending' || t.status === 'rejected') && (
          <Button size="sm" variant="primary" icon={Check} onClick={() => act('gallery.approve')}>
            {tr('approve')}
          </Button>
        )}
        {t.status === 'pending' && (
          <Button size="sm" icon={X} onClick={() => act('gallery.reject')}>
            {tr('decline')}
          </Button>
        )}
        {t.status === 'approved' && (
          <Button size="sm" variant="danger" onClick={() => act('gallery.remove')}>
            {tr('remove')}
          </Button>
        )}
        {t.status === 'removed' && (
          <Button size="sm" icon={ShieldCheck} onClick={() => act('gallery.restore')}>
            {tr('restore')}
          </Button>
        )}
        {t.submitter && (
          <Button size="sm" variant="ghost" icon={UserX} onClick={() => onAct({ action: 'user.suspend', targetId: t.submitter!.id, targetLabel: `${t.submitter!.name} <${t.submitter!.email}>`, reason: 'other' })}>
            {tr('gallerySuspendSubmitter')}
          </Button>
        )}
      </div>
    </article>
  );
}

export function GalleryView({ version, onAct }: { version: number; onAct: (a: GalleryAct) => void }) {
  const [status, setStatus] = useState<GalleryStatus>('pending');
  const [list, setList] = useState<GalleryForReview[] | null>(null);
  const notify = useToast();
  useEffect(() => {
    let live = true;
    setList(null);
    api.moderationGallery(status).then(
      (r) => live && setList(r.templates),
      (e: unknown) => {
        if (!live) return;
        notify(e instanceof ApiError ? e.message : tr('somethingWentWrongTryAgain'), 'error');
        setList([]);
      },
    );
    return () => {
      live = false;
    };
  }, [status, version, notify]);
  return (
    <main className="fr-op__queue" aria-label={tr('communityTemplates')}>
      <div className="fr-op-listings__bar">
        <Select<GalleryStatus>
          aria-label={tr('communityTemplates')}
          value={status}
          onChange={setStatus}
          options={(['pending', 'approved', 'rejected', 'removed'] as const).map((s) => ({ value: s, label: STATUS_CHIP[s].label }))}
        />
      </div>
      {list === null ? (
        <Spinner size={22} label={tr('loading')} />
      ) : list.length === 0 ? (
        <p className="fr-op__empty">{status === 'pending' ? tr('noTemplateIsWaiting') : tr('none')}</p>
      ) : (
        list.map((t) => <GalleryCard key={t.id} t={t} onAct={onAct} />)
      )}
    </main>
  );
}
