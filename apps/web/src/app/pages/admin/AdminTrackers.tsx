// Trackers (KAI-153): the team's connections to Jira, Linear and GitHub. Members (not guests) use
// them on the workspace's boards — "Send to tracker", issue badges, imports. Every sync is in the
// audit log; the server enforces who manages and who uses each connection.
import type { WorkspaceSummary } from '@freero/shared';
import { TrackerConnections } from '../../components/TrackerConnections';

import { t } from './messages';
export function AdminTrackers({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <section aria-labelledby="admin-trackers-title">
      <h1 id="admin-trackers-title" className="fr-admin__title">{t('issueTrackers')}</h1>
      <p className="fr-admin__intro">{t('connectYourTeamSTracker')}</p>
      <TrackerConnections workspaceId={workspace.id} />
    </section>
  );
}
