// Why a workspace's boards are closed to you (WorkspaceSummary.blocked) and what to do about it.
import { Link } from 'react-router-dom';
import { KeyRound, Network, ShieldAlert, UserX } from 'lucide-react';
import type { WorkspaceSummary } from '@freero/shared';

import { t } from './messages';
export function WorkspaceBlockedNotice({ workspace }: { workspace: WorkspaceSummary }) {
  if (workspace.blocked === 'two_factor_required')
    return (
      <div className="fr-dash-blocked" role="status">
        <ShieldAlert size={18} aria-hidden />
        <span>{t('nameRequiresTwoStepVerification', { name: workspace.name })}<Link to="/settings#two-factor">{t('turnItOnInYour')}</Link>.
        </span>
      </div>
    );
  if (workspace.blocked === 'ip_not_allowed')
    return (
      <div className="fr-dash-blocked" role="status">
        <Network size={18} aria-hidden />
        <span>{t('nameOpensItsBoardsOnly', { name: workspace.name })}</span>
      </div>
    );
  if (workspace.blocked === 'key_unavailable')
    return (
      <div className="fr-dash-blocked" role="status">
        <KeyRound size={18} aria-hidden />
        <span>
          {workspace.name} encrypts its boards with its own key, and that key can’t be used right now (its admins suspended it, or its key service refused or
          didn’t answer). Its boards stay closed until the key is available again.
        </span>
      </div>
    );
  if (workspace.blocked === 'deactivated')
    return (
      <div className="fr-dash-blocked" role="status">
        <UserX size={18} aria-hidden />
        <span>{t('yourAccessToNameWas', { name: workspace.name })}</span>
      </div>
    );
  return null;
}
