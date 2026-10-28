// Usage of the workspace at a glance, with the two numbers admins act on most (people without
// two-step verification, deactivated members) linking to where they are handled.
import { useEffect, useState } from 'react';
import type { WorkspaceSettings, WorkspaceSummary, WorkspaceUsage } from '@freero/shared';
import { Spinner } from '@ui';
import { api, ApiError } from '../../api/client';

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
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load the workspace’s usage'));
    return () => {
      live = false;
    };
  }, [workspace.id]);

  if (error) return <p className="fr-admin__error">{error}</p>;
  if (!usage || !settings) return <Spinner />;
  const people = usage.members.owner + usage.members.admin + usage.members.member + usage.members.guest;

  return (
    <section aria-labelledby="admin-overview-title">
      <h1 id="admin-overview-title" className="fr-admin__title">
        Overview
      </h1>
      <div className="fr-admin-stats">
        <Stat label="Boards" value={usage.boards} note={usage.trashedBoards ? `${usage.trashedBoards} in the trash` : 'Trash is empty'} />
        <Stat label="People" value={people} note={`${usage.members.owner + usage.members.admin} owners & admins · ${usage.members.guest} ${usage.members.guest === 1 ? 'guest' : 'guests'}`} />
        <Stat label="Active, last 7 days" value={usage.activeUsers7d} note={`${usage.activeUsers30d} in the last 30 days`} />
        <Stat label="Storage" value={formatBytes(usage.contentBytes + usage.fileBytes)} note={`${formatBytes(usage.fileBytes)} in files, ${formatBytes(usage.contentBytes)} board content`} />
        <Stat label="Projects" value={usage.projects} note={usage.pendingInvites ? `${usage.pendingInvites} invites pending` : 'No pending invites'} />
      </div>

      <h2 className="fr-admin__subtitle">Needs attention</h2>
      <ul className="fr-admin-checks">
        <Check
          ok={settings.requireTwoFactor || without2fa === 0}
          text={
            settings.requireTwoFactor
              ? 'Two-step verification is required to open this workspace’s boards.'
              : without2fa === 0
                ? 'Every active member uses two-step verification.'
                : `${without2fa} ${without2fa === 1 ? 'member doesn’t' : 'members don’t'} use two-step verification, and the workspace doesn’t require it.`
          }
          action={settings.requireTwoFactor || without2fa === 0 ? null : { label: 'Security settings', run: () => onOpen('security') }}
        />
        <Check
          ok={usage.deactivated === 0}
          text={usage.deactivated === 0 ? 'No deactivated members.' : `${usage.deactivated} deactivated ${usage.deactivated === 1 ? 'member keeps' : 'members keep'} their boards but can’t open anything here.`}
          action={usage.deactivated === 0 ? null : { label: 'Review members', run: () => onOpen('members') }}
        />
        <Check
          ok={settings.sessionMaxHours !== null || settings.sessionIdleMinutes !== null}
          text={
            settings.sessionMaxHours !== null || settings.sessionIdleMinutes !== null
              ? 'Sessions of members end under the workspace’s session policy.'
              : 'Members stay signed in for up to 30 days, even when idle.'
          }
          action={settings.sessionMaxHours !== null || settings.sessionIdleMinutes !== null ? null : { label: 'Set a session policy', run: () => onOpen('security') }}
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
