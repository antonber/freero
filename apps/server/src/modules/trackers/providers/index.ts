// The trackers Freero syncs with. A new one: a file implementing TrackerProvider (types.ts), a
// line here and its kind in TRACKER_PROVIDERS (@freero/shared) — nothing else changes.
import type { TrackerProviderKind } from '@freero/shared';
import { github } from './github';
import { jira, jiraOAuth } from './jira';
import { linear } from './linear';
import type { OAuthProvider, TrackerProvider } from './types';

const PROVIDERS: Record<TrackerProviderKind, TrackerProvider> = {
  jira,
  linear,
  github,
};
const OAUTH: Partial<Record<TrackerProviderKind, OAuthProvider>> = {
  jira: jiraOAuth,
};

export const providerOf = (kind: TrackerProviderKind): TrackerProvider => PROVIDERS[kind];
export const oauthProviderOf = (kind: TrackerProviderKind): OAuthProvider | null => OAUTH[kind] ?? null;
export type { TrackerProvider, ProviderConnection, RemoteIssue, Credentials, Backlink } from './types';
