// The trackers Freero syncs with. A new one: a file implementing TrackerProvider (types.ts), a
// line here and its kind in TRACKER_PROVIDERS (@freero/shared) — nothing else changes.
import type { TrackerProviderKind } from '@freero/shared';
import { asana, asanaOAuth } from './asana';
import { azure } from './azure';
import { clickup, clickupOAuth } from './clickup';
import { github } from './github';
import { jira, jiraOAuth } from './jira';
import { linear } from './linear';
import { monday, mondayOAuth } from './monday';
import type { OAuthProvider, TrackerProvider } from './types';

const PROVIDERS: Record<TrackerProviderKind, TrackerProvider> = {
  jira,
  linear,
  github,
  azure,
  asana,
  monday,
  clickup,
};
const OAUTH: Partial<Record<TrackerProviderKind, OAuthProvider>> = {
  jira: jiraOAuth,
  asana: asanaOAuth,
  monday: mondayOAuth,
  clickup: clickupOAuth,
};

export const providerOf = (kind: TrackerProviderKind): TrackerProvider => PROVIDERS[kind];
export const oauthProviderOf = (kind: TrackerProviderKind): OAuthProvider | null => OAUTH[kind] ?? null;
export type { TrackerProvider, ProviderConnection, RemoteIssue, Credentials, Backlink } from './types';
