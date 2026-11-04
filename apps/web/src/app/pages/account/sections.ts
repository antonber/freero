// Account settings: its groups (one shown at a time, each at /settings/<group>) and which group
// every section lives in. Links into settings name a section: /settings#two-factor from the
// dashboard, /settings#notifications in Slack messages and emails already sent, the server's
// redirects (/settings?section=trackers, ?connected=, ?error=, ?slack=…#slack). Those forms must
// keep working for good, so they resolve here to the group that now holds the section.

export const SETTINGS_GROUPS = ['profile', 'preferences', 'notifications', 'security', 'integrations', 'developer', 'account'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** Every section's element id (its anchor) → its group. A section is a SettingsSection, typed by these ids. */
export const SECTION_GROUP = {
  profile: 'profile',
  appearance: 'preferences',
  language: 'preferences',
  'time-zone': 'preferences',
  notifications: 'notifications',
  // The anchors of the notification cards before settings had groups.
  'notifications-settings': 'notifications',
  'device-notifications': 'notifications',
  'notification-types': 'notifications',
  email: 'security',
  'sign-in': 'security',
  password: 'security',
  'two-factor': 'security',
  sessions: 'security',
  slack: 'integrations',
  'connect-agent': 'integrations',
  'connected-apps': 'integrations',
  trackers: 'integrations',
  'api-tokens': 'developer',
  'developer-apps': 'developer',
  problems: 'account',
  data: 'account',
  delete: 'account',
} as const satisfies Record<string, SettingsGroup>;
export type SettingsSectionId = keyof typeof SECTION_GROUP;

const isGroup = (x: string): x is SettingsGroup => (SETTINGS_GROUPS as readonly string[]).includes(x);
const isSection = (x: string): x is SettingsSectionId => Object.prototype.hasOwnProperty.call(SECTION_GROUP, x);

export const groupPath = (group: SettingsGroup) => `/settings/${group}`;

export interface SettingsTarget {
  group: SettingsGroup;
  /** The section to scroll to, if the address names one. */
  section: SettingsSectionId | null;
  /** Where to go instead (replacing this entry) when the address is an older or misplaced form. */
  redirect: string | null;
}

/**
 * Where an address under /settings lands. `pathname` is /settings or /settings/<group>.
 * - /settings → Profile (as it always opened); /settings/<unknown> → /settings.
 * - #<section> on any of them → that section's group (#two-factor → /settings/security#two-factor).
 * - ?section=<id> (the trackers' OAuth return) → its group, as #<id>.
 * - ?connected= / ?error= (back from a sign-in provider) → Security, at sign-in methods, which reads them.
 * - ?slack= / ?slack_error= (back from Slack's consent) → Integrations, at Slack, which reads them.
 */
export function settingsTarget(pathname: string, search: string, hash: string): SettingsTarget {
  const segment = pathname.replace(/\/+$/, '').split('/')[2] ?? '';
  const inPath = isGroup(segment) ? segment : null;
  const query = new URLSearchParams(search);
  const anchor = hash.replace(/^#/, '');
  const fromQuery = query.get('section') ?? '';
  const section: SettingsSectionId | null = isSection(anchor)
    ? anchor
    : isSection(fromQuery)
      ? fromQuery
      : query.has('connected') || query.has('error')
        ? 'sign-in'
        : query.has('slack') || query.has('slack_error')
          ? 'slack'
          : null;
  const group: SettingsGroup = section ? SECTION_GROUP[section] : (inPath ?? 'profile');
  const unknownGroup = segment !== '' && !inPath;
  const canonical = group === inPath && !query.has('section') && (!section || anchor === section);
  if (canonical || (!unknownGroup && !inPath && !section)) return { group, section, redirect: null };
  if (unknownGroup && !section) return { group, section: null, redirect: `/settings${search}` };
  query.delete('section');
  const rest = query.toString();
  return { group, section, redirect: `${groupPath(group)}${rest ? `?${rest}` : ''}${section ? `#${section}` : ''}` };
}
