// Security (two-step requirement, session policy, sharing policies) and data retention settings
// of a team workspace. The server validates and enforces all of them; changes apply at once.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { WorkspacePolicies, WorkspaceSettings, WorkspaceSummary } from '@freero/shared';
import { Select, Spinner, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { parseSetting, POLICY_FIELDS, SETTING_FIELDS, settingValue } from './policies';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

function useSettings(workspaceId: string) {
  const notify = useToast();
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  useEffect(() => {
    api.workspaceSettings(workspaceId).then(
      (r) => setSettings(r.settings),
      (e) => notify(errorText(e, 'Could not load the settings'), 'error'),
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
      notify(errorText(e, 'Could not save the setting'), 'error');
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

/** A numeric setting as a Select; a value set elsewhere (the API) that isn't a preset still shows. */
function SettingSelect({ field, settings, save }: { field: keyof typeof SETTING_FIELDS; settings: WorkspaceSettings; save: ReturnType<typeof useSettings>['save'] }) {
  const f = SETTING_FIELDS[field];
  const value = settingValue(settings[field]);
  const options: SelectOption<string>[] = f.options.some((o) => o.value === value) ? f.options : [...f.options, { value, label: value }];
  return (
    <Row label={f.label} hint={f.hint}>
      <Select<string> aria-label={f.label} options={options} value={value} onChange={(v) => void save({ [field]: parseSetting(v) }, 'Saved — it applies right away')} width={230} />
    </Row>
  );
}

export function AdminSecurity({ workspace, onChanged }: { workspace: WorkspaceSummary; onChanged: (w: WorkspaceSummary) => void }) {
  const notify = useToast();
  const { settings, save } = useSettings(workspace.id);
  const [policies, setPolicies] = useState(workspace.policies);
  useEffect(() => setPolicies(workspace.policies), [workspace.policies]);

  const setPolicy = async (key: keyof WorkspacePolicies, value: string) => {
    const prev = policies;
    setPolicies({ ...policies, [key]: value });
    try {
      onChanged((await api.updateWorkspace(workspace.id, { policies: { [key]: value } })).workspace);
      notify('Policy updated — it applies to everyone right away', 'success');
    } catch (e) {
      setPolicies(prev);
      notify(errorText(e, 'Could not update the policy'), 'error');
    }
  };

  if (!settings) return <Spinner />;
  return (
    <section aria-labelledby="admin-security-title">
      <h1 id="admin-security-title" className="fr-admin__title">
        Security
      </h1>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">Sign-in</h2>
        <Row
          label="Require two-step verification"
          hint={
            <>
              Anyone without it — members, guests and people invited from outside — can’t open this workspace’s boards until they turn it on
              in <Link to="/settings#two-factor">their settings</Link>, and members can’t turn it off. Turn it on for yourself first.
            </>
          }
        >
          <Toggle
            aria-label="Require two-step verification"
            checked={settings.requireTwoFactor}
            onChange={(on) => void save({ requireTwoFactor: on }, on ? 'Two-step verification is now required' : 'Two-step verification is no longer required')}
          />
        </Row>
        <SettingSelect field="sessionMaxHours" settings={settings} save={save} />
        <SettingSelect field="sessionIdleMinutes" settings={settings} save={save} />
        <p className="fr-admin-card__note">
          A sign-in belongs to a person, not to a workspace: someone in several workspaces gets the strictest of their session policies
          on all their devices. Guests keep their own account’s settings.
        </p>
      </div>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">Sharing</h2>
        {POLICY_FIELDS.map((f) => (
          <Row key={f.key} label={f.label} hint={f.hint}>
            <Select<string> aria-label={f.label} options={f.options} value={policies[f.key]} onChange={(v) => void setPolicy(f.key, v)} width={230} />
          </Row>
        ))}
      </div>
    </section>
  );
}

export function AdminRetention({ workspace }: { workspace: WorkspaceSummary }) {
  const { settings, save } = useSettings(workspace.id);
  if (!settings) return <Spinner />;
  return (
    <section aria-labelledby="admin-retention-title">
      <h1 id="admin-retention-title" className="fr-admin__title">
        Data retention
      </h1>
      <div className="fr-admin-card">
        <SettingSelect field="trashRetentionDays" settings={settings} save={save} />
        <SettingSelect field="versionRetentionDays" settings={settings} save={save} />
        <SettingSelect field="auditRetentionDays" settings={settings} save={save} />
        <p className="fr-admin-card__note">Freero applies these every hour. What is removed can’t be brought back.</p>
      </div>
    </section>
  );
}
