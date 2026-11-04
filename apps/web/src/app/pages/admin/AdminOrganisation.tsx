// Organisations above team workspaces (#108; docs/design/organisations.md), in the admin console:
// - `WorkspaceOrganisation` (a team workspace's Overview): which organisation it belongs to, or —
//   for its owners — attach it to one they run, or create one for it;
// - `OrgWorkspaces` (the organisation console's first tab): its workspaces with owners and
//   members, attach another one you own, detach one, delete the organisation.
// The server checks every rule (who may attach / detach, floors); this only hides what can't work.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronDown, ChevronRight, Unlink } from 'lucide-react';
import type { OrganisationSummary, OrganisationWorkspace, OrganisationWorkspaceMember, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Select, Spinner, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const runs = (o: { role: string }) => o.role === 'owner' || o.role === 'admin';
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** The Overview card of a team workspace. */
export function WorkspaceOrganisation({ workspace, onChanged }: { workspace: WorkspaceSummary; onChanged: () => void }) {
  const notify = useToast();
  const [mine, setMine] = useState<OrganisationSummary[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const org = workspace.organisation ?? null;
  const owner = workspace.role === 'owner';

  useEffect(() => {
    if (org || !owner) return;
    api.listOrganisations().then(
      ({ organisations }) => setMine(organisations.filter(runs)),
      () => setMine([]),
    );
  }, [org, owner]);

  const attach = async (organisationId: string) => {
    setBusy(true);
    try {
      await api.attachToOrganisation(organisationId, workspace.id);
      notify(t('nameIsNowPartOf', { name: workspace.name }), 'success');
      onChanged();
    } catch (e) {
      notify(errorText(e, t('couldNotAttachTheWorkspace')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { organisation } = await api.createOrganisation(name.trim());
      await api.attachToOrganisation(organisation.id, workspace.id);
      notify(t('nameIsSetUpWith', { name: organisation.name, name2: workspace.name }), 'success');
      onChanged();
    } catch (err) {
      notify(errorText(err, t('couldNotCreateTheOrganisation')), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fr-admin-card fr-admin-org">
      <h2 className="fr-admin-card__title">
        <Building2 size={16} aria-hidden />{' '}{t('organisation')}</h2>
      {org ? (
        <p className="fr-admin-org__text">{t('partOf')}{' '}<strong>{org.name}</strong>{' '}{t('sinceDayItsSingleSign', { day: day(org.attachedAt) })}{' '}<Link to="?tab=security">{t('security')}</Link>).
          {org.yourRole === 'owner' || org.yourRole === 'admin' ? (
            <>
              {' '}
              <Link to={`/org/${encodeURIComponent(org.id)}`}>{t('openTheOrganisationConsole')}</Link>
            </>
          ) : null}
        </p>
      ) : !owner ? (
        <p className="fr-admin-org__text">{t('thisWorkspaceIsOnIts')}</p>
      ) : mine === null ? (
        <Spinner />
      ) : (
        <>
          <p className="fr-admin-org__text">{t('onItsOwnInAn')}</p>
          {mine.length ? (
            <div className="fr-admin-org__row">
              <Select<string>
                aria-label={t('organisationToJoin')}
                options={[{ value: '', label: t('chooseAnOrganisation') }, ...mine.map((o): SelectOption<string> => ({ value: o.id, label: o.name }))]}
                value={chosen}
                onChange={setChosen}
                width={240}
              />
              <Button loading={busy} disabled={!chosen} onClick={() => void attach(chosen)}>{t('attach')}</Button>
            </div>
          ) : null}
          <form className="fr-admin-org__row" onSubmit={create}>
            <Input aria-label={t('newOrganisationSName')} placeholder={t('yourCompanySName')} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant={mine.length ? 'secondary' : 'primary'} loading={busy} disabled={!name.trim()}>{t('createOrganisation')}</Button>
          </form>
        </>
      )}
    </div>
  );
}

/** The organisation console's Workspaces tab. */
export function OrgWorkspaces({ organisation, onChanged }: { organisation: OrganisationSummary; onChanged: () => void }) {
  const notify = useToast();
  const [list, setList] = useState<OrganisationWorkspace[] | null>(null);
  const [ownTeams, setOwnTeams] = useState<WorkspaceSummary[]>([]);
  const [chosen, setChosen] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, OrganisationWorkspaceMember[]>>({});
  const [detach, setDetach] = useState<OrganisationWorkspace | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.organisationWorkspaces(organisation.id).then(
      ({ workspaces }) => setList(workspaces),
      (e) => notify(errorText(e, t('couldNotLoadTheWorkspaces')), 'error'),
    );
    api.listWorkspaces().then(
      ({ workspaces }) => setOwnTeams(workspaces.filter((w) => w.kind === 'team' && w.role === 'owner' && !w.organisation)),
      () => setOwnTeams([]),
    );
  }, [organisation.id, notify]);
  useEffect(load, [load]);

  const toggle = async (w: OrganisationWorkspace) => {
    if (open === w.id) return setOpen(null);
    setOpen(w.id);
    if (!members[w.id])
      try {
        const r = await api.organisationWorkspaceMembers(organisation.id, w.id);
        setMembers((m) => ({ ...m, [w.id]: r.members }));
      } catch (e) {
        notify(errorText(e, t('couldNotLoadItsMembers')), 'error');
      }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      notify(ok, 'success');
      setChosen('');
      setDetach(null);
      load();
      onChanged();
      return true;
    } catch (e) {
      notify(errorText(e, t('thatDidnTWork')), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!list) return <Spinner />;
  return (
    <section aria-labelledby="org-workspaces-title">
      <div className="fr-admin__head">
        <h1 id="org-workspaces-title" className="fr-admin__title">{t('workspaces')}</h1>
        <span className="fr-admin__muted">{t('lengthTeamWorkspacesInName', { length: list.length, name: organisation.name })}</span>
      </div>
      <p className="fr-admin__intro">{t('everyWorkspaceHereUsesThe')}</p>

      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">{t('workspace')}</th>
              <th scope="col">{t('owners')}</th>
              <th scope="col">{t('people')}</th>
              <th scope="col">{t('since')}</th>
              <th scope="col">
                <span className="fr-admin__sr">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <WorkspaceRow key={w.id} w={w} open={open === w.id} members={members[w.id]} onToggle={() => void toggle(w)} onDetach={() => setDetach(w)} />
            ))}
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className="fr-admin__muted">{t('noWorkspaceIsInThe')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{t('addAWorkspace')}</h2>
        <p className="fr-admin-card__note">{t('youCanAddATeam', { name: organisation.name })}</p>
        <div className="fr-admin-org__row fr-admin-org__row--last">
          <Select<string>
            aria-label={t('workspaceToAdd')}
            options={[
              { value: '', label: ownTeams.length ? t('chooseOneOfYourWorkspaces') : t('youOwnNoOtherTeam') },
              ...ownTeams.map((w): SelectOption<string> => ({ value: w.id, label: w.name })),
            ]}
            value={chosen}
            onChange={setChosen}
            width={280}
          />
          <Button loading={busy} disabled={!chosen} onClick={() => void act(() => api.attachToOrganisation(organisation.id, chosen), t('workspaceAdded'))}>{t('addToName', { name: organisation.name })}</Button>
        </div>
      </div>

      {organisation.role === 'owner' ? (
        <div className="fr-admin-card">
          <h2 className="fr-admin-card__title">{t('deleteTheOrganisation')}</h2>
          <div className="fr-admin-row">
            <div className="fr-admin-row__text">
              <span className="fr-admin-row__hint">{t('itsSingleSignOnProvisioning')}</span>
            </div>
            <div className="fr-admin-row__control">
              <Button variant="danger" disabled={list.length > 0} onClick={() => setDeleting(true)}>{t('delete')}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={detach !== null}
        onClose={() => setDetach(null)}
        title={t('removeValueFromName', { value: detach?.name ?? '', name: organisation.name })}
        width={460}
        footer={
          <>
            <Button onClick={() => setDetach(null)}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => detach && void act(() => api.detachFromOrganisation(organisation.id, detach.id), t('nameIsOnItsOwn', { name: detach.name }))}>{t('remove')}</Button>
          </>
        }
      >
        <p className="fr-admin__modal-text">{t('itKeepsItsPeopleAnd')}</p>
      </Modal>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t('deleteName', { name: organisation.name })}
        width={440}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>{t('cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={confirm.trim() !== organisation.name}
              onClick={() =>
                void act(() => api.deleteOrganisation(organisation.id, confirm), t('nameWasDeleted', { name: organisation.name })).then((ok) => {
                  if (ok) window.location.assign('/app');
                })
              }
            >{t('delete')}</Button>
          </>
        }
      >
        <p className="fr-admin__modal-text">{t('typeItsNameToConfirm')}</p>
        <Input aria-label={t('organisationName')} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={organisation.name} />
      </Modal>
    </section>
  );
}

function WorkspaceRow({
  w,
  open,
  members,
  onToggle,
  onDetach,
}: {
  w: OrganisationWorkspace;
  open: boolean;
  members: OrganisationWorkspaceMember[] | undefined;
  onToggle: () => void;
  onDetach: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button type="button" className="fr-admin-org__toggle" aria-expanded={open} onClick={onToggle}>
            {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
            <span className="fr-admin-person__name">{w.name}</span>
          </button>
          {w.yourRole ? <div className="fr-admin__muted fr-admin-org__you">{t('youRe')}{' '}{w.yourRole === 'owner' || w.yourRole === 'admin' ? 'an' : 'a'}{' '}{t('yourroleHere', { yourRole: w.yourRole })}</div> : null}
        </td>
        <td>
          {w.owners.map((o) => (
            <div key={o.userId}>
              {o.name} <span className="fr-admin__muted">{o.email}</span>
            </div>
          ))}
        </td>
        <td>{w.memberCount}</td>
        <td className="fr-admin__muted fr-admin__nowrap">{day(w.attachedAt)}</td>
        <td className="fr-admin-table__actions">
          <Button size="sm" variant="ghost" icon={Unlink} onClick={onDetach}>{t('remove')}</Button>
        </td>
      </tr>
      {open ? (
        <tr className="fr-admin-org__members">
          <td colSpan={5}>
            {!members ? (
              <Spinner />
            ) : (
              <ul className="fr-admin-org__people">
                {members.map((m) => (
                  <li key={m.userId}>
                    <span className="fr-admin-person__name">{m.name}</span> <span className="fr-admin__muted">{m.email}</span>{' '}
                    <span className="fr-admin-role">{m.role}</span>
                    {m.deactivated ? <span className="fr-admin-pill fr-admin-pill--off">{t('deactivated')}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
