// What the Apps & agents page adds to the shared catalog (@freero/shared integrations.ts): generic
// category icons from Freero's own icon set (never a third party's logo), the filter, and the
// team admin console links filled in per workspace.
import { AppWindow, Bot, HardDrive, KeyRound, MessagesSquare, Puzzle, Ticket, Video, Workflow, type LucideIcon } from 'lucide-react';
import {
  ADMIN_LINK_PREFIX,
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  integrationMatches,
  type CommunityListing,
  type Integration,
  type IntegrationAppLink,
  type IntegrationCategory,
  type WorkspaceSummary,
} from '@freero/shared';

export const CATEGORY_ICON: Record<IntegrationCategory, LucideIcon> = {
  agents: Bot,
  trackers: Ticket,
  chat: MessagesSquare,
  embeds: AppWindow,
  calls: Video,
  identity: KeyRound,
  automation: Workflow,
  storage: HardDrive,
};
export const COMMUNITY_ICON = Puzzle;

export const categoryLabel = (c: IntegrationCategory) => INTEGRATION_CATEGORIES.find((x) => x.id === c)?.label ?? c;

/** A filter chip: every category, plus the community's listings. */
export type AppsFilter = IntegrationCategory | 'community' | 'all';

export function filterCatalog(query: string, filter: AppsFilter): Integration[] {
  if (filter === 'community') return [];
  return INTEGRATIONS.filter((i) => (filter === 'all' || i.category === filter) && integrationMatches(i, query));
}

export function filterListings(listings: readonly CommunityListing[], query: string, filter: AppsFilter): CommunityListing[] {
  if (filter !== 'all' && filter !== 'community' && !listings.some((l) => l.category === filter)) return [];
  return listings.filter(
    (l) => (filter === 'all' || filter === 'community' || l.category === filter) && integrationMatches({ name: l.name, oneLiner: l.tagline, keywords: ['community'], category: l.category }, query),
  );
}

/**
 * Where an in-app link goes for this person: a fixed route as it is, or — for a team admin console
 * link — one per team they own or administer (none: they ask an admin).
 */
export function appLinkTargets(link: IntegrationAppLink, workspaces: readonly WorkspaceSummary[]): Array<{ to: string; label: string }> {
  if (!link.path.startsWith(ADMIN_LINK_PREFIX)) return [{ to: link.path, label: link.label }];
  const rest = link.path.slice(ADMIN_LINK_PREFIX.length);
  const teams = workspaces.filter((w) => w.kind === 'team' && (w.role === 'owner' || w.role === 'admin') && w.blocked !== 'deactivated');
  return teams.map((w) => ({ to: `/admin/${encodeURIComponent(w.id)}${rest}`, label: `${link.label} · ${w.name}` }));
}
