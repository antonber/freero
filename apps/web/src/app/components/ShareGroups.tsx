// The share dialog's groups (#63): the groups of the board's workspace it is shared with, each with
// its role; whoever may invite people adds a group, owners and co-owners change or remove one. The
// server decides (a group with guests only by who may invite guests); this only offers it.
import { useEffect, useState } from 'react';
import { UsersRound, X } from 'lucide-react';
import type { BoardGroupGrant, BoardSummary, WorkspaceGroup } from '@freero/shared';
import { IconButton, Select, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';

import { t } from '../messages';
type GroupRole = BoardGroupGrant['role'];
const ROLES: SelectOption<GroupRole>[] = [
  { value: 'editor', label: t('canEdit') },
  { value: 'commenter', label: t('canComment') },
  { value: 'viewer', label: t('canView') },
];
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function ShareGroups({ board }: { board: BoardSummary }) {
  const notify = useToast();
  const [grants, setGrants] = useState<BoardGroupGrant[] | null>(null);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [role, setRole] = useState<GroupRole>('editor');
  const manages = board.permissions.manageSharing ?? board.role === 'owner';
  const invites = board.permissions.invite ?? (board.role === 'owner' || board.role === 'editor');

  useEffect(() => {
    let live = true;
    api.listBoardGroups(board.id).then((r) => live && setGrants(r.groups), () => live && setGrants([]));
    if (invites) api.listGroups(board.workspaceId).then((r) => live && setGroups(r.groups), () => live && setGroups([]));
    return () => {
      live = false;
    };
  }, [board.id, board.workspaceId, invites]);

  const share = async (groupId: string, as: GroupRole) => {
    try {
      setGrants((await api.shareBoardWithGroup(board.id, groupId, as)).groups);
    } catch (e) {
      notify(errorText(e, t('couldNotShareItWith')), 'error');
    }
  };
  const unshare = async (groupId: string) => {
    try {
      setGrants((await api.unshareBoardGroup(board.id, groupId)).groups);
    } catch (e) {
      notify(errorText(e, t('couldNotStopSharingIt')), 'error');
    }
  };

  if (!grants || (!grants.length && !groups.length)) return null;
  const candidates = groups.filter((g) => !grants.some((x) => x.groupId === g.id));
  return (
    <section aria-label={t('groupsWithAccess')}>
      <h3 className="fr-share__heading">{t('groups')}</h3>
      <ul className="fr-share__members">
        {grants.map((g) => (
          <li key={g.groupId} className="fr-share__member" data-testid="share-group">
            <span className="fr-share__link-icon fr-share__link-icon--open">
              <UsersRound size={16} aria-hidden />
            </span>
            <div className="fr-share__who">
              <span className="fr-share__name">{g.name}</span>
              <span className="fr-share__email-text">
                {g.memberCount} {g.memberCount === 1 ? 'person' : 'people'}
              </span>
            </div>
            <div className="fr-share__member-actions">
              {manages ? (
                <>
                  <Select<GroupRole> aria-label={t('whatNameCanDo', { name: g.name })} size="sm" options={ROLES} value={g.role} onChange={(r) => void share(g.groupId, r)} width={130} />
                  <IconButton size={32} icon={X} label={t('stopSharingWithName', { name: g.name })} tooltipSide="top" onClick={() => void unshare(g.groupId)} />
                </>
              ) : (
                <span className="fr-share__role">{ROLES.find((r) => r.value === g.role)?.label}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {invites && candidates.length ? (
        <div className="fr-share__groups-add">
          <Select<string>
            aria-label={t('shareWithAGroup')}
            options={[{ value: '', label: t('shareWithAGroup2'), disabled: true }, ...candidates.map((g) => ({ value: g.id, label: `${g.name} (${g.memberCount})` }))]}
            value=""
            onChange={(id) => id && void share(id, role)}
            width={240}
          />
          <Select<GroupRole> aria-label={t('whatTheGroupCanDo')} options={ROLES} value={role} onChange={setRole} width={140} />
        </div>
      ) : null}
    </section>
  );
}
