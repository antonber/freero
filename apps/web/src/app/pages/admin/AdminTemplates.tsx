// Templates shared with the workspace — or, for an organisation, published to it (company
// templates, #155) — for its owners and content admins: lock one (everyone uses it, only admins
// change or remove it), retire one (out of every picker, kept) or withdraw it. Who may share or
// publish is the "Who shares templates" policy (Security → Sharing). The server checks everything.
import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Lock, LockOpen, Undo2 } from 'lucide-react';
import type { SavedTemplateSummary, WorkspaceSummary } from '@freero/shared';
import { Button, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

import { t as tr } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminTemplates({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const org = workspace.kind === 'organisation';
  const [templates, setTemplates] = useState<SavedTemplateSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.placeTemplates(workspace.id).then(
      (r) => setTemplates(r.templates),
      (e) => notify(errorText(e, tr('couldNotLoadTheTemplates')), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const act = async (t: SavedTemplateSummary, what: string, run: () => Promise<unknown>, done: string) => {
    setBusy(`${t.id}:${what}`);
    try {
      await run();
      notify(done, 'success');
      load();
    } catch (e) {
      notify(errorText(e, tr('couldNotChangeIt')), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!templates) return <Spinner />;
  return (
    <section aria-labelledby="admin-templates-title">
      <div className="fr-admin__head">
        <h1 id="admin-templates-title" className="fr-admin__title">
          {org ? tr('companyTemplates') : tr('teamTemplates')}
        </h1>
        <span className="fr-admin__muted">
          {org
            ? tr('templatesPublishedToNameEvery', { name: workspace.name })
            : tr('templatesSharedWithNameEvery', { name: workspace.name })}
        </span>
      </div>
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">{tr('template')}</th>
              <th scope="col">{tr('sharedBy')}</th>
              <th scope="col">{tr('updated')}</th>
              <th scope="col">
                <span className="fr-admin__sr">{tr('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className={t.retiredAt ? 'fr-admin-table__row--off' : undefined}>
                <td>
                  <div className="fr-admin-person__name">
                    {t.name}
                    {t.locked ? <span className="fr-admin-pill">{tr('locked')}</span> : null}
                    {t.retiredAt ? <span className="fr-admin-pill fr-admin-pill--off">{tr('retired')}</span> : null}
                  </div>
                  <div className="fr-admin__muted">{t.description || tr('elementcountItems', { elementCount: t.elementCount })}</div>
                </td>
                <td>{t.ownerName}</td>
                <td className="fr-admin__muted">{relativeTime(t.updatedAt)}</td>
                <td className="fr-admin-table__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={t.locked ? LockOpen : Lock}
                    loading={busy === `${t.id}:lock`}
                    onClick={() => void act(t, 'lock', () => api.setTemplateLocked(t.id, !t.locked), t.locked ? tr('nameIsUnlocked', { name: t.name }) : tr('nameIsLocked', { name: t.name }))}
                  >
                    {t.locked ? tr('unlock') : tr('lock')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={t.retiredAt ? ArchiveRestore : Archive}
                    loading={busy === `${t.id}:retire`}
                    onClick={() =>
                      void act(t, 'retire', () => api.setTemplateRetired(t.id, !t.retiredAt), t.retiredAt ? tr('nameIsBackInThe', { name: t.name }) : tr('nameIsRetired', { name: t.name }))
                    }
                  >
                    {t.retiredAt ? tr('bringBack') : tr('retire')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Undo2}
                    loading={busy === `${t.id}:withdraw`}
                    onClick={() =>
                      void act(t, 'withdraw', () => (org ? api.publishTemplate(t.id, null) : api.shareTemplate(t.id, null)), tr('nameIsBackWithOwnername', { name: t.name, ownerName: t.ownerName }))
                    }
                  >{tr('withdraw')}</Button>
                </td>
              </tr>
            ))}
            {templates.length === 0 ? (
              <tr>
                <td colSpan={4} className="fr-admin__muted">
                  {org ? tr('nothingPublishedYetMembersPublish') : tr('nothingSharedYet')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
