// The choices the admin console offers for a team workspace's policies and settings. The server
// validates every value (WORKSPACE_SETTING_LIMITS); these are just the sensible steps.
import type { LinkAccess, WorkspacePolicies, WorkspaceSettings } from '@freero/shared';
import type { SelectOption } from '@ui';

/** The policies that are a choice among words (`linkMaxDays`, a number of days, has its own field). */
export type ChoicePolicy = Exclude<keyof WorkspacePolicies, 'linkMaxDays'>;

export const POLICY_FIELDS: Array<{
  key: ChoicePolicy;
  label: string;
  hint: string;
  options: SelectOption<string>[];
}> = [
  {
    key: 'teamAccess',
    label: 'Members on the team’s boards',
    hint: 'What every member can do on the workspace’s boards. A project can set its own level; owners and admins always edit, and people invited to a board keep their role.',
    options: [
      { value: 'editor', label: 'Can edit' },
      { value: 'commenter', label: 'Can comment' },
      { value: 'viewer', label: 'Can view' },
    ],
  },
  {
    key: 'externalSharing',
    label: 'Sharing outside the workspace',
    hint: 'Who may invite people who aren’t in this workspace to its boards, or share them by link. “Nobody” also ends such access that exists today.',
    options: [
      { value: 'anyone', label: 'Board owners and editors' },
      { value: 'admins', label: 'Owners and admins only' },
      { value: 'none', label: 'Nobody' },
    ],
  },
  {
    key: 'linkSharing',
    label: 'Links to boards',
    hint: 'The most a board’s “anyone with the link” can grant. Existing links above it are lowered right away.',
    options: [
      { value: 'editor', label: 'Up to “can edit”' },
      { value: 'commenter', label: 'Up to “can comment”' },
      { value: 'viewer', label: 'Up to “can view”' },
      { value: 'none', label: 'Links are off' },
    ] satisfies SelectOption<LinkAccess>[],
  },
  {
    key: 'linkPassword',
    label: 'Password on board links',
    hint: 'Required: a board’s link can only be turned on or changed with a password. Links that are on today keep working; the list below shows them.',
    options: [
      { value: 'optional', label: 'Up to the board' },
      { value: 'required', label: 'Required' },
    ],
  },
  {
    key: 'publicLinks',
    label: 'Visitors without an account',
    hint: 'Whether a board’s link also lets in people without a Freero account, as a named guest who can view or comment for a few hours.',
    options: [
      { value: 'anyone', label: 'Allowed on shared links' },
      { value: 'signedIn', label: 'Sign-in required' },
    ],
  },
  {
    key: 'guestInvites',
    label: 'Inviting guests',
    hint: 'Guests see only the boards and projects shared with them.',
    options: [
      { value: 'admins', label: 'Owners and admins' },
      { value: 'members', label: 'Any member' },
    ],
  },
  {
    key: 'liveEmbeds',
    label: 'Live embeds',
    hint: 'Whether links to videos, design files, docs and code playgrounds can be opened as live frames on the boards (after a click). Off: every link stays a preview card.',
    options: [
      { value: 'on', label: 'Allowed' },
      { value: 'off', label: 'Off' },
    ],
  },
  {
    key: 'boardEmbeds',
    label: 'Embedding boards on other sites',
    hint: 'Whether board owners can embed their boards live in wikis, docs and websites. An embed never shows more than the board’s sharing allows. Off: no board shows on any other site, and embeds already placed stop working.',
    options: [
      { value: 'on', label: 'Allowed' },
      { value: 'off', label: 'Off' },
    ],
  },
  {
    key: 'downloads',
    label: 'Export, download and copy',
    hint: 'Who may export boards as images or PDF, duplicate them or save them as templates.',
    options: [
      { value: 'anyone', label: 'Anyone with access' },
      { value: 'members', label: 'Members (not guests)' },
      { value: 'admins', label: 'Owners and admins only' },
    ],
  },
];

/** `linkMaxDays` (#39): '' stands for no limit. */
export const LINK_MAX_DAYS_FIELD = {
  label: 'Board links expire within',
  hint: 'Turning a board’s link on or changing it needs an expiry no later than this. Links that are on today keep working; the list below shows them.',
  options: [
    { value: '', label: 'No limit' },
    ...[1, 7, 14, 30, 90, 180, 365].map((d) => ({ value: String(d), label: d === 1 ? '1 day' : `${d} days` })),
  ] satisfies SelectOption<string>[],
};

type NumberSetting = Exclude<keyof WorkspaceSettings, 'requireTwoFactor'>;

/** Select values are strings; '' stands for null (no limit). */
export const SETTING_FIELDS: Record<NumberSetting, { label: string; hint: string; options: SelectOption<string>[] }> = {
  sessionMaxHours: {
    label: 'Sign-in lasts at most',
    hint: 'After this long, members sign in again — on every device, whatever they are doing.',
    options: [
      { value: '', label: '30 days (Freero’s default)' },
      { value: '8', label: '8 hours' },
      { value: '12', label: '12 hours' },
      { value: '24', label: '1 day' },
      { value: '168', label: '7 days' },
      { value: '336', label: '14 days' },
    ],
  },
  sessionIdleMinutes: {
    label: 'Sign out after inactivity',
    hint: 'A session nobody has used for this long ends. Editing a board counts as activity.',
    options: [
      { value: '', label: 'Never' },
      { value: '15', label: '15 minutes' },
      { value: '30', label: '30 minutes' },
      { value: '60', label: '1 hour' },
      { value: '240', label: '4 hours' },
      { value: '1440', label: '1 day' },
    ],
  },
  trashRetentionDays: {
    label: 'Deleted boards stay in the trash for',
    hint: 'Then they are deleted for good, with their history. Shortening it applies to boards already in the trash.',
    options: [7, 14, 30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: d === 30 ? '30 days (default)' : `${d} days` })),
  },
  versionRetentionDays: {
    label: 'Keep unnamed versions for',
    hint: 'Automatic versions and “before restore” copies older than this are deleted. Named versions are always kept.',
    options: [
      { value: '', label: 'Always (thinned out)' },
      ...[30, 90, 180, 365, 730].map((d) => ({ value: String(d), label: `${d} days` })),
    ],
  },
  auditRetentionDays: {
    label: 'Keep audit events for',
    hint: 'Older events are removed from the workspace’s audit log. Export the log first if you need to keep it longer.',
    options: [90, 180, 365, 730, 1095, 2555].map((d) => ({ value: String(d), label: d === 365 ? '1 year (default)' : d % 365 === 0 ? `${d / 365} years` : d === 2555 ? '7 years' : `${d} days` })),
  },
};

export const settingValue = (v: number | null) => (v === null ? '' : String(v));
export const parseSetting = (v: string) => (v === '' ? null : Number(v));
