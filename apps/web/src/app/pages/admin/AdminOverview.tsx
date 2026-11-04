// Usage of the workspace at a glance, with the two numbers admins act on most (people without
// two-step verification, deactivated members) linking to where they are handled.
import { useEffect, useState } from 'react';
import type { WorkspaceSettings, WorkspaceSummary, WorkspaceUsage } from '@freero/shared';
import { Spinner } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function AdminOverview({ workspace, onOpen }: { workspace: WorkspaceSummary; onOpen: (tab: 'members' | 'security' | 'audit') => void }) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [without2fa, setWithout2fa] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.adminUsage(workspace.id), api.workspaceSettings(workspace.id), api.adminMembers(workspace.id)])
      .then(([u, s, m]) => {
        if (!live) return;
        setUsage(u.usage);
        setSettings(s.settings);
        setWithout2fa(m.members.filter((x) => !x.twoFactor && !x.deactivated).length);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : t('couldNotLoadTheWorkspace')));
    return () => {
      live = false;
    };
  }, [workspace.id]);

  if (error) return <p className="fr-admin__error">{error}</p>;
  if (!usage || !settings) return <Spinner />;
  const people = usage.members.owner + usage.members.admin + usage.members.member + usage.members.guest;

  return (
    <section aria-labelledby="admin-overview-title">
      <h1 id="admin-overview-title" className="fr-admin__title">{t('overview')}</h1>
      <div className="fr-admin-stats">
        <Stat
          label={t('boards')}
          value={usage.boards}
          note={[usage.archivedBoards ? `${usage.archivedBoards} archived` : null, usage.trashedBoards ? `${usage.trashedBoards} in the trash` : t('trashIsEmpty')].filter(Boolean).join(' · ')}
        />
        <Stat label={t('people')} value={people} note={t('valueOwnersAdminsGuestGuests', { guest: usage.members.guest, value: usage.members.owner + usage.members.admin })} />
        <Stat label={t('activeLast7Days')} value={usage.activeUsers7d} note={t('activeusers30dInTheLast30', { activeUsers30d: usage.activeUsers30d })} />
        <Stat label={t('storage')} value={formatBytes(usage.contentBytes + usage.fileBytes)} note={t('valueInFilesValue2Board', { value: formatBytes(usage.fileBytes), value2: formatBytes(usage.contentBytes) })} />
        <Stat label={t('projects')} value={usage.projects} note={usage.pendingInvites ? t('pendinginvitesInvitesPending', { pendingInvites: usage.pendingInvites }) : t('noPendingInvites')} />
      </div>

      <h2 className="fr-admin__subtitle">{t('needsAttention')}</h2>
      <ul className="fr-admin-checks">
        <Check
          ok={settings.requireTwoFactor || without2fa === 0}
          text={
            settings.requireTwoFactor
              ? t('twoStepVerificationIsRequired')
              : without2fa === 0
                ? t('everyActiveMemberUsesTwo')
                : t('without2faMembersDonTUse', { without2fa })
          }
          action={settings.requireTwoFactor || without2fa === 0 ? null : { label: t('securitySettings'), run: () => onOpen('security') }}
        />
        <Check
          ok={usage.deactivated === 0}
          text={usage.deactivated === 0 ? t('noDeactivatedMembers') : t('deactivatedDeactivatedMembersKeepTheir', { deactivated: usage.deactivated })}
          action={usage.deactivated === 0 ? null : { label: t('reviewMembers'), run: () => onOpen('members') }}
        />
        <Check
          ok={settings.sessionMaxHours !== null || settings.sessionIdleMinutes !== null}
          text={
            settings.sessionMaxHours !== null || settings.sessionIdleMinutes !== null
              ? t('sessionsOfMembersEndUnder')
              : t('membersStaySignedInFor')
          }
          action={settings.sessionMaxHours !== null || settings.sessionIdleMinutes !== null ? null : { label: t('setASessionPolicy'), run: () => onOpen('security') }}
        />
      </ul>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="fr-admin-stat">
      <span className="fr-admin-stat__label">{label}</span>
      <span className="fr-admin-stat__value">{value}</span>
      <span className="fr-admin-stat__note">{note}</span>
    </div>
  );
}

function Check({ ok, text, action }: { ok: boolean; text: string; action: { label: string; run: () => void } | null }) {
  return (
    <li className={`fr-admin-check${ok ? ' fr-admin-check--ok' : ''}`}>
      <span className="fr-admin-check__dot" aria-hidden />
      <span className="fr-admin-check__text">{text}</span>
      {action ? (
        <button type="button" className="fr-admin__link" onClick={action.run}>
          {action.label}
        </button>
      ) : null}
    </li>
  );
}
