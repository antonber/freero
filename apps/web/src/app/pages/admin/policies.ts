// The choices the admin console offers for a team workspace's policies and settings. The server
// validates every value (WORKSPACE_SETTING_LIMITS); these are just the sensible steps.
import type { InactiveBoardAction, LinkAccess, WorkspacePolicies, WorkspaceSettings } from '@freero/shared';
import type { SelectOption } from '@ui';

import { t } from './messages';
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
    label: t('membersOnTheTeamS'),
    hint: t('whatEveryMemberCanDo'),
    options: [
      { value: 'editor', label: t('canEdit') },
      { value: 'commenter', label: t('canComment') },
      { value: 'viewer', label: t('canView') },
    ],
  },
  {
    key: 'externalSharing',
    label: t('sharingOutsideTheWorkspace'),
    hint: t('whoMayInvitePeopleWho'),
    options: [
      { value: 'anyone', label: t('boardOwnersAndEditors') },
      { value: 'admins', label: t('ownersAndAdminsOnly') },
      { value: 'none', label: t('nobody') },
    ],
  },
  {
    key: 'linkSharing',
    label: t('linksToBoards'),
    hint: t('theMostABoardS'),
    options: [
      { value: 'editor', label: 'Up to “can edit”' },
      { value: 'commenter', label: 'Up to “can comment”' },
      { value: 'viewer', label: 'Up to “can view”' },
      { value: 'none', label: 'Links are off' },
    ] satisfies SelectOption<LinkAccess>[],
  },
  {
    key: 'linkPassword',
    label: t('passwordOnBoardLinks'),
    hint: t('requiredABoardSLink'),
    options: [
      { value: 'optional', label: t('upToTheBoard') },
      { value: 'required', label: t('required') },
    ],
  },
  {
    key: 'publicLinks',
    label: t('visitorsWithoutAnAccount'),
    hint: t('whetherABoardSLink'),
    options: [
      { value: 'anyone', label: t('allowedOnSharedLinks') },
      { value: 'signedIn', label: t('signInRequired') },
    ],
  },
  {
    key: 'guestInvites',
    label: t('invitingGuests'),
    hint: t('guestsSeeOnlyTheBoards'),
    options: [
      { value: 'admins', label: t('ownersAndAdmins') },
      { value: 'members', label: t('anyMember') },
    ],
  },
  {
    key: 'liveEmbeds',
    label: t('liveEmbeds'),
    hint: t('whetherLinksToVideosDesign'),
    options: [
      { value: 'on', label: t('allowed') },
      { value: 'off', label: t('off') },
    ],
  },
  {
    key: 'templatePublishing',
    label: t('whoSharesTemplates'),
    hint: t('whoMayShareATemplate'),
    options: [
      { value: 'members', label: t('anyMember') },
      { value: 'admins', label: t('ownersAndContentAdmins') },
    ],
  },
  {
    key: 'boardEmbeds',
    label: t('embeddingBoardsOnOtherSites'),
    hint: t('whetherBoardOwnersCanEmbed'),
    options: [
      { value: 'on', label: t('allowed') },
      { value: 'off', label: t('off') },
    ],
  },
  {
    key: 'downloads',
    label: t('exportDownloadAndCopy'),
    hint: t('whoMayExportBoardsAs'),
    options: [
      { value: 'anyone', label: t('anyoneWithAccess') },
      { value: 'members', label: t('membersNotGuests') },
      { value: 'admins', label: t('ownersAndAdminsOnly') },
    ],
  },
];

/** `linkMaxDays` (#39): '' stands for no limit. */
export const LINK_MAX_DAYS_FIELD = {
  label: t('boardLinksExpireWithin'),
  hint: t('turningABoardSLink'),
  options: [
    { value: '', label: 'No limit' },
    ...[1, 7, 14, 30, 90, 180, 365].map((d) => ({ value: String(d), label: d === 1 ? '1 day' : `${d} days` })),
  ] satisfies SelectOption<string>[],
};

type NumberSetting = Exclude<keyof WorkspaceSettings, 'requireTwoFactor' | 'inactiveBoardAction' | 'ipAllowlist'>;

/** Select values are strings; '' stands for null (no limit). */
export const SETTING_FIELDS: Record<NumberSetting, { label: string; hint: string; options: SelectOption<string>[] }> = {
  sessionMaxHours: {
    label: t('signInLastsAtMost'),
    hint: t('afterThisLongMembersSign'),
    options: [
      { value: '', label: t('n30DaysFreeroSDefault') },
      { value: '8', label: t('n8Hours') },
      { value: '12', label: t('n12Hours') },
      { value: '24', label: t('n1Day') },
      { value: '168', label: t('n7Days') },
      { value: '336', label: t('n14Days') },
    ],
  },
  sessionIdleMinutes: {
    label: t('signOutAfterInactivity'),
    hint: t('aSessionNobodyHasUsed'),
    options: [
      { value: '', label: t('never') },
      { value: '15', label: t('n15Minutes') },
      { value: '30', label: t('n30Minutes') },
      { value: '60', label: t('n1Hour') },
      { value: '240', label: t('n4Hours') },
      { value: '1440', label: t('n1Day') },
    ],
  },
  trashRetentionDays: {
    label: t('deletedBoardsStayInThe'),
    hint: t('thenTheyAreDeletedFor'),
    options: [7, 14, 30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: d === 30 ? t('n30DaysDefault') : t('dDays', { d }) })),
  },
  versionRetentionDays: {
    label: t('keepUnnamedVersionsFor'),
    hint: t('automaticVersionsAndBeforeRestore'),
    options: [
      { value: '', label: t('alwaysThinnedOut') },
      ...[30, 90, 180, 365, 730].map((d) => ({ value: String(d), label: t('dDays', { d }) })),
    ],
  },
  inactiveBoardDays: {
    label: t('after'),
    hint: t('daysNobodyOpenedOrChanged'),
    options: [
      { value: '', label: t('chooseAPeriod') },
      ...[90, 180, 365, 730, 1095].map((d) => ({ value: String(d), label: d % 365 === 0 ? (d === 365 ? t('n1Year') : t('valueYears', { value: d / 365 })) : t('dDays', { d }) })),
    ],
  },
  auditRetentionDays: {
    label: t('keepAuditEventsFor'),
    hint: t('olderEventsAreRemovedFrom'),
    options: [90, 180, 365, 730, 1095, 2555].map((d) => ({ value: String(d), label: d === 365 ? t('n1YearDefault') : d % 365 === 0 ? t('valueYears', { value: d / 365 }) : d === 2555 ? t('n7Years') : t('dDays', { d }) })),
  },
};

export const settingValue = (v: number | null) => (v === null ? '' : String(v));

/** #154: what happens to boards nobody uses (loosest to strictest, as the organisation's floor orders them). */
export const INACTIVE_ACTION_OPTIONS: SelectOption<InactiveBoardAction>[] = [
  { value: 'none', label: t('nothing') },
  { value: 'archive', label: t('archiveThemReadOnlyKept') },
  { value: 'trash', label: t('moveThemToTheTrash') },
];
export const parseSetting = (v: string) => (v === '' ? null : Number(v));
