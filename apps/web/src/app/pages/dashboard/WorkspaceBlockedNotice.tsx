// Why a workspace's boards are closed to you (WorkspaceSummary.blocked) and what to do about it.
import { Link } from 'react-router-dom';
import { ShieldAlert, UserX } from 'lucide-react';
import type { WorkspaceSummary } from '@freero/shared';

export function WorkspaceBlockedNotice({ workspace }: { workspace: WorkspaceSummary }) {
  if (workspace.blocked === 'two_factor_required')
    return (
      <div className="fr-dash-blocked" role="status">
        <ShieldAlert size={18} aria-hidden />
        <span>
          {workspace.name} requires two-step verification. Its boards stay closed to you until you{' '}
          <Link to="/settings#two-factor">turn it on in your settings</Link>.
        </span>
      </div>
    );
  if (workspace.blocked === 'deactivated')
    return (
      <div className="fr-dash-blocked" role="status">
        <UserX size={18} aria-hidden />
        <span>Your access to {workspace.name} was deactivated by its admins, so its boards are closed to you. Ask them to reactivate you.</span>
      </div>
    );
  return null;
}
