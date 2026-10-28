// Trackers (KAI-153): the team's connections to Jira, Linear and GitHub. Members (not guests) use
// them on the workspace's boards — "Send to tracker", issue badges, imports. Every sync is in the
// audit log; the server enforces who manages and who uses each connection.
import type { WorkspaceSummary } from '@freero/shared';
import { TrackerConnections } from '../../components/TrackerConnections';

export function AdminTrackers({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <section aria-labelledby="admin-trackers-title">
      <h1 id="admin-trackers-title" className="fr-admin__title">
        Issue trackers
      </h1>
      <p className="fr-admin__intro">
        Connect your team’s tracker so members can turn sticky notes, clusters and cards into issues — with every field kept, a link back to each
        item, and changes flowing both ways. Each connection acts as the account whose token you give it.
      </p>
      <TrackerConnections workspaceId={workspace.id} />
    </section>
  );
}
