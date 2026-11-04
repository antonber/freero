// Security (two-step requirement, session policy, sharing policies) and data retention settings
// of a team workspace. The server validates and enforces all of them; changes apply at once. For
// an organisation (#108) the same controls set FLOORS for its workspaces; in an attached workspace
// choices looser than the organisation's floor are shown but disabled (the server refuses them).
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  INACTIVE_BOARD_ACTIONS,
  looserPolicy,
  POLICY_STRICTNESS,
  RETENTION_NOTICE_DAYS,
  type InactiveBoardAction,
  type LinkComplianceIssue,
  type OrderedPolicyKey,
  type WorkspacePolicies,
  type WorkspaceSettings,
  type WorkspaceSummary,
} from '@freero/shared';
import { Select, Spinner, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { AdminNetworks } from './AdminNetworks';
import { INACTIVE_ACTION_OPTIONS, LINK_MAX_DAYS_FIELD, parseSetting, POLICY_FIELDS, SETTING_FIELDS, settingValue } from './policies';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

function useSettings(workspaceId: string) {
  const notify = useToast();
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  useEffect(() => {
    api.workspaceSettings(workspaceId).then(
      (r) => setSettings(r.settings),
      (e) => notify(errorText(e, t('couldNotLoadTheSettings')), 'error'),
    );
  }, [workspaceId, notify]);
  const save = async (patch: Partial<WorkspaceSettings>, done: string) => {
    const prev = settings;
    if (prev) setSettings({ ...prev, ...patch });
    try {
      setSettings((await api.updateWorkspaceSettings(workspaceId, patch)).settings);
      notify(done, 'success');
    } catch (e) {
      setSettings(prev);
      notify(errorText(e, t('couldNotSaveTheSetting')), 'error');
    }
  };
  return { settings, save };
}

function Row({ label, hint, children }: { label: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="fr-admin-row">
      <div className="fr-admin-row__text">
        <span className="fr-admin-row__label">{label}</span>
        <span className="fr-admin-row__hint">{hint}</span>
      </div>
      <div className="fr-admin-row__control">{children}</div>
    </div>
  );
}

/**
 * A numeric setting as a Select; a value set elsewhere (the API) that isn't a preset still shows.
 * `floor` (an organisation's limit): longer limits, and none, can't be chosen.
 */
function SettingSelect({
  field,
  settings,
  save,
  floor = null,
  by,
}: {
  field: keyof typeof SETTING_FIELDS;
  settings: WorkspaceSettings;
  save: ReturnType<typeof useSettings>['save'];
  floor?: number | null;
  by?: string;
}) {
  const f = SETTING_FIELDS[field];
  const value = settingValue(settings[field]);
  const all: SelectOption<string>[] = f.options.some((o) => o.value === value) ? f.options : [...f.options, { value, label: value }];
  const options = floor === null ? all : all.map((o) => ({ ...o, disabled: o.value === '' || Number(o.value) > floor }));
  const hint = floor === null ? f.hint : `${f.hint} ${by} allows at most ${all.find((o) => o.value === String(floor))?.label ?? floor}.`;
  return (
    <Row label={f.label} hint={hint}>
      <Select<string> aria-label={f.label} options={options} value={value} onChange={(v) => void save({ [field]: parseSetting(v) }, t('savedItAppliesRightAway'))} width={230} />
    </Row>
  );
}

export function AdminSecurity({ workspace, onChanged }: { workspace: WorkspaceSummary; onChanged: (w: WorkspaceSummary) => void }) {
  const notify = useToast();
  const { settings, save } = useSettings(workspace.id);
  const [policies, setPolicies] = useState(workspace.policies);
  useEffect(() => setPolicies(workspace.policies), [workspace.policies]);
  const org = workspace.kind === 'organisation';
  const floor = workspace.organisation ?? null;
  const floorOf = (key: keyof WorkspacePolicies) => (floor && key !== 'teamAccess' && key !== 'linkMaxDays' ? floor.policies[key as OrderedPolicyKey] : null);
  const maxDaysFloor = floor?.policies.linkMaxDays ?? null;

  const setPolicy = async <K extends keyof WorkspacePolicies>(key: K, value: WorkspacePolicies[K]) => {
    const prev = policies;
    setPolicies({ ...policies, [key]: value });
    try {
      onChanged((await api.updateWorkspace(workspace.id, { policies: { [key]: value } })).workspace);
      notify(t('policyUpdatedItAppliesTo'), 'success');
    } catch (e) {
      setPolicies(prev);
      notify(errorText(e, t('couldNotUpdateThePolicy')), 'error');
    }
  };
  const maxDays = settingValue(policies.linkMaxDays);
  const maxDaysOptions = LINK_MAX_DAYS_FIELD.options.some((o) => o.value === maxDays) ? LINK_MAX_DAYS_FIELD.options : [...LINK_MAX_DAYS_FIELD.options, { value: maxDays, label: t('maxdaysDays', { maxDays }) }];

  // #151: sign-in is the security admins', sharing the content admins' (a server from before sends no scopes).
  const scopes = workspace.adminScopes ?? ['members', 'content', 'security'];
  if (!settings) return <Spinner />;
  return (
    <section aria-labelledby="admin-security-title">
      <h1 id="admin-security-title" className="fr-admin__title">
        {org ? t('policies') : t('security')}
      </h1>
      {org ? (
        <p className="fr-admin__intro">{t('whatYouSetHereIs', { name: workspace.name })}</p>
      ) : floor ? (
        <p className="fr-admin__intro">{t('nameSetsTheLeastThis', { name: floor.name })}</p>
      ) : null}

      {scopes.includes('security') ? (
      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{t('signIn')}</h2>
        <Row
          label={t('requireTwoStepVerification')}
          hint={
            org ? (
              <>{t('nobodyWithoutItCanOpen')}</>
            ) : (
              <>{t('anyoneWithoutItMembersGuests')}{' '}<Link to="/settings#two-factor">{t('theirSettings')}</Link>{t('andMembersCanTTurn')}{floor?.settings.requireTwoFactor ? t('nameRequiresIt', { name: floor.name }) : ''}
              </>
            )
          }
        >
          <Toggle
            aria-label={t('requireTwoStepVerification')}
            checked={settings.requireTwoFactor}
            disabled={!!floor?.settings.requireTwoFactor}
            onChange={(on) => void save({ requireTwoFactor: on }, on ? t('twoStepVerificationIsNow') : t('twoStepVerificationIsNo'))}
          />
        </Row>
        <SettingSelect field="sessionMaxHours" settings={settings} save={save} floor={floor?.settings.sessionMaxHours ?? null} by={floor?.name} />
        <SettingSelect field="sessionIdleMinutes" settings={settings} save={save} floor={floor?.settings.sessionIdleMinutes ?? null} by={floor?.name} />
        <p className="fr-admin-card__note">
          A sign-in belongs to a person, not to a workspace: someone in several workspaces gets the strictest of their session policies
          on all their devices. Guests keep their own account’s settings. Single sign-on follows the same policy; an identity provider’s own
          session end can only make one sign-in shorter.
        </p>
      </div>
      ) : null}
      {scopes.includes('security') ? <AdminNetworks workspace={workspace} /> : null}

      {scopes.includes('content') ? (
      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{t('sharing')}</h2>
        {POLICY_FIELDS.filter((f) => !org || f.key !== 'teamAccess').map((f) => {
          const least = floorOf(f.key);
          const key = f.key as OrderedPolicyKey;
          const options = least === null ? f.options : f.options.map((o) => ({ ...o, disabled: looserPolicy(key, o.value as never, least as never) }));
          // Only a floor that rules something out is worth a word (the loosest value is no floor).
          const binding = least !== null && least !== POLICY_STRICTNESS[key][0];
          const hint = binding ? t('hintSetByNameLabel', { hint: f.hint, name: floor!.name, label: String(f.options.find((o) => o.value === least)?.label ?? '') }) : f.hint;
          return (
            <Row key={f.key} label={f.label} hint={hint}>
              <Select<string>
                aria-label={f.label}
                options={options}
                value={policies[f.key]}
                onChange={(v) => void setPolicy(f.key, v as WorkspacePolicies[typeof f.key])}
                width={230}
              />
            </Row>
          );
        })}
        <Row label={LINK_MAX_DAYS_FIELD.label} hint={maxDaysFloor === null ? LINK_MAX_DAYS_FIELD.hint : t('hintSetByNameMaxdaysfloor', { hint: LINK_MAX_DAYS_FIELD.hint, name: floor!.name, maxDaysFloor })}>
          <Select<string>
            aria-label={LINK_MAX_DAYS_FIELD.label}
            options={maxDaysFloor === null ? maxDaysOptions : maxDaysOptions.map((o) => ({ ...o, disabled: o.value === '' || Number(o.value) > maxDaysFloor }))}
            value={maxDays}
            onChange={(v) => void setPolicy('linkMaxDays', parseSetting(v))}
            width={230}
          />
        </Row>
        {org ? null : <LinkCompliance workspaceId={workspace.id} policies={policies} />}
      </div>
      ) : null}
    </section>
  );
}

const PROBLEM_TEXT = { no_password: 'no password', no_expiry: 'no expiry', expiry_too_late: 'expires too late' } as const;

/**
 * The boards whose link is on but doesn't meet the link policy (#39): turning the policy on never
 * breaks them, so admins see which ones to ask their owners about.
 */
function LinkCompliance({ workspaceId, policies }: { workspaceId: string; policies: WorkspacePolicies }) {
  const [boards, setBoards] = useState<LinkComplianceIssue[] | null>(null);
  const active = policies.linkPassword === 'required' || policies.linkMaxDays !== null;
  useEffect(() => {
    if (!active) return setBoards(null);
    let live = true;
    api.linkCompliance(workspaceId).then(
      (r) => live && setBoards(r.boards),
      () => live && setBoards([]),
    );
    return () => {
      live = false;
    };
  }, [workspaceId, active, policies.linkPassword, policies.linkMaxDays]);
  if (!active || !boards) return null;
  return (
    <div className="fr-admin-compliance" aria-label={t('boardLinksOutsideThePolicy')}>
      <span className="fr-admin-row__label">{boards.length ? t('lengthBoardLinksDonT', { length: boards.length }) : t('everyBoardLinkMeetsThe')}</span>
      {boards.length ? (
        <ul className="fr-admin-compliance__list">
          {boards.map((b) => (
            <li key={b.boardId}>
              <Link to={`/board/${encodeURIComponent(b.boardId)}?share=1`}>{b.title || t('untitledBoard')}</Link>
              <span className="fr-admin-row__hint">
                {' '}
                · {b.ownerName} · {b.problems.map((p) => PROBLEM_TEXT[p]).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="fr-admin-row__hint">{t('theyKeepWorkingUntilTheir')}</span>
    </div>
  );
}

export function AdminRetention({ workspace }: { workspace: WorkspaceSummary }) {
  const { settings, save } = useSettings(workspace.id);
  if (!settings) return <Spinner />;
  // An organisation holds no boards: only its own (merged) audit log has a retention.
  const org = workspace.kind === 'organisation';
  // #151: boards' and versions' retention is content's, the audit log's security's.
  const scopes = workspace.adminScopes ?? ['members', 'content', 'security'];
  const content = !org && scopes.includes('content');
  return (
    <section aria-labelledby="admin-retention-title">
      <h1 id="admin-retention-title" className="fr-admin__title">{t('dataRetention')}</h1>
      <div className="fr-admin-card">
        {content ? <SettingSelect field="trashRetentionDays" settings={settings} save={save} /> : null}
        {content ? <SettingSelect field="versionRetentionDays" settings={settings} save={save} /> : null}
        {scopes.includes('security') ? <SettingSelect field="auditRetentionDays" settings={settings} save={save} /> : null}
        <p className="fr-admin-card__note">{t('freeroAppliesTheseEveryHour')}</p>
      </div>
      {scopes.includes('content') ? <InactiveBoards workspace={workspace} settings={settings} save={save} /> : null}
    </section>
  );
}

/**
 * #154: archive or trash boards nobody used for a while. For an organisation it is the floor of
 * its workspaces; in an attached workspace, gentler actions and longer periods than the
 * organisation's are greyed out.
 */
function InactiveBoards({ workspace, settings, save }: { workspace: WorkspaceSummary; settings: WorkspaceSettings; save: ReturnType<typeof useSettings>['save'] }) {
  const org = workspace.kind === 'organisation';
  const floor = workspace.organisation ?? null;
  const leastAction = floor?.settings.inactiveBoardAction ?? 'none';
  const leastDays = floor?.settings.inactiveBoardDays ?? null;
  const rank = (a: InactiveBoardAction) => INACTIVE_BOARD_ACTIONS.indexOf(a);
  const action = settings.inactiveBoardAction ?? 'none';
  const days = settings.inactiveBoardDays ?? null;
  const daysField = SETTING_FIELDS.inactiveBoardDays;
  const value = settingValue(days);
  const dayOptions = (daysField.options.some((o) => o.value === value) ? daysField.options : [...daysField.options, { value, label: t('valueDays', { value }) }]).map((o) => ({
    ...o,
    disabled: o.value === '' || (leastDays !== null && Number(o.value) > leastDays),
  }));
  const done = (a: InactiveBoardAction, d: number | null) =>
    a === 'none' || d === null ? t('boardsAreNoLongerArchived') : t('savedOwnersHearRetentionNotice', { retention_notice_days: RETENTION_NOTICE_DAYS });
  return (
    <div className="fr-admin-card">
      <h2 className="fr-admin-card__title">{t('boardsNobodyUses')}</h2>
      <Row
        label={t('whatHappensToThem')}
        hint={
          <>
            {org
              ? t('theLeastEveryWorkspaceIn', { name: workspace.name })
              : floor && leastAction !== 'none'
                ? t('nameRequiresAtLeastLabel', { name: floor.name, label: String(INACTIVE_ACTION_OPTIONS.find((o) => o.value === leastAction)?.label ?? '') })
                : ''}{t('ownersAreEmailedRetentionNotice', { retention_notice_days: RETENTION_NOTICE_DAYS })}</>
        }
      >
        <Select<InactiveBoardAction>
          aria-label={t('whatHappensToBoardsNobody')}
          options={INACTIVE_ACTION_OPTIONS.map((o) => ({ ...o, disabled: rank(o.value) < rank(leastAction) }))}
          value={action}
          onChange={(a) => {
            const d = a === 'none' ? days : (days ?? leastDays ?? 365);
            void save(a === 'none' ? { inactiveBoardAction: a } : { inactiveBoardAction: a, inactiveBoardDays: d }, done(a, d));
          }}
          width={230}
        />
      </Row>
      {action !== 'none' ? (
        <Row label={daysField.label} hint={leastDays !== null && !org ? t('hintNameAllowsAtMost', { hint: daysField.hint, name: floor!.name, leastDays }) : daysField.hint}>
          <Select<string>
            aria-label={t('daysWithoutActivity')}
            options={dayOptions}
            value={value}
            onChange={(v) => void save({ inactiveBoardDays: parseSetting(v) }, done(action, parseSetting(v)))}
            width={230}
          />
        </Row>
      ) : null}
    </div>
  );
}
