// A team workspace's settings (owners/admins): name, sharing policies (enforced by the server —
// this page only edits them), ownership transfer and deletion (owners).
import { useEffect, useState, type FormEvent } from 'react';
import { Crown, Trash2 } from 'lucide-react';
import type { LinkAccess, WorkspaceMember, WorkspacePolicies, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Select, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { ScimBlock, SsoBlock, WorkspaceDataBlock } from './WorkspaceEnterprise';

const POLICY_FIELDS: Array<{
  key: keyof WorkspacePolicies;
  label: string;
  hint: string;
  options: SelectOption<string>[];
}> = [
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
    key: 'guestInvites',
    label: 'Inviting guests',
    hint: 'Guests see only the boards and projects shared with them.',
    options: [
      { value: 'admins', label: 'Owners and admins' },
      { value: 'members', label: 'Any member' },
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

export function WorkspaceSettings({
  workspace,
  onChanged,
  onDeleted,
}: {
  workspace: WorkspaceSummary;
  onChanged: (w: WorkspaceSummary) => void;
  onDeleted: () => void;
}) {
  const notify = useToast();
  const owner = workspace.role === 'owner';
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState(workspace.policies);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [heir, setHeir] = useState('');
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(workspace.name);
    setPolicies(workspace.policies);
  }, [workspace]);

  useEffect(() => {
    if (!owner) return;
    api
      .listWorkspaceMembers(workspace.id)
      .then(({ members }) => setMembers(members))
      .catch(() => setMembers([]));
  }, [owner, workspace.id]);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === workspace.name) return;
    setSaving(true);
    try {
      onChanged((await api.updateWorkspace(workspace.id, { name: name.trim() })).workspace);
      notify('Workspace renamed', 'success');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not rename the workspace', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setPolicy = async (key: keyof WorkspacePolicies, value: string) => {
    const prev = policies;
    setPolicies({ ...policies, [key]: value });
    try {
      onChanged((await api.updateWorkspace(workspace.id, { policies: { [key]: value } })).workspace);
      notify('Policy updated — it applies to everyone right away', 'success');
    } catch (err) {
      setPolicies(prev);
      notify(err instanceof ApiError ? err.message : 'Could not update the policy', 'error');
    }
  };

  const transfer = async () => {
    setBusy(true);
    try {
      onChanged((await api.transferWorkspace(workspace.id, heir)).workspace);
      setConfirmTransfer(false);
      notify('Ownership transferred. You are now an admin.', 'success');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not transfer the workspace', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteWorkspace(workspace.id, confirmName);
      notify(`Deleted ${workspace.name}`, 'info');
      onDeleted();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not delete the workspace', 'error');
      setBusy(false);
    }
  };

  const heirs = members.filter((m) => m.role !== 'guest' && m.role !== 'owner');
  const heirName = heirs.find((m) => m.userId === heir)?.name;

  return (
    <section className="fr-dash-page" aria-label="Workspace settings">
      <header className="fr-dash-page__head">
        <h1 className="fr-collection__title">Workspace settings</h1>
      </header>

      <form className="fr-dash-settings__block" onSubmit={rename}>
        <h2 className="fr-dash-settings__title">Name</h2>
        <div className="fr-dash-settings__row">
          <Input aria-label="Workspace name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === workspace.name}>
            Save
          </Button>
        </div>
      </form>

      <div className="fr-dash-settings__block">
        <h2 className="fr-dash-settings__title">Sharing policies</h2>
        {POLICY_FIELDS.map((f) => (
          <div key={f.key} className="fr-dash-settings__policy">
            <div className="fr-dash-settings__policy-text">
              <span className="fr-dash-settings__label">{f.label}</span>
              <span className="fr-dash-settings__hint">{f.hint}</span>
            </div>
            <Select<string> aria-label={f.label} options={f.options} value={policies[f.key]} onChange={(v) => setPolicy(f.key, v)} width={220} />
          </div>
        ))}
      </div>

      {workspace.kind === 'team' ? (
        <>
          <SsoBlock workspace={workspace} />
          <ScimBlock workspace={workspace} />
          <WorkspaceDataBlock workspace={workspace} />
        </>
      ) : null}

      {owner ? (
        <>
          <div className="fr-dash-settings__block">
            <h2 className="fr-dash-settings__title">Ownership</h2>
            <p className="fr-dash-settings__hint">Hand the workspace to another member. They become an owner; you stay on as an admin.</p>
            <div className="fr-dash-settings__row">
              <Select<string>
                aria-label="New owner"
                options={[{ value: '', label: heirs.length ? 'Choose a member' : 'No members yet', disabled: true }, ...heirs.map((m) => ({ value: m.userId, label: m.name, description: m.email }))]}
                value={heir}
                onChange={setHeir}
                width={260}
              />
              <Button icon={Crown} disabled={!heir} onClick={() => setConfirmTransfer(true)}>
                Transfer ownership
              </Button>
            </div>
          </div>

          <div className="fr-dash-settings__block fr-dash-settings__block--danger">
            <h2 className="fr-dash-settings__title">Delete workspace</h2>
            <p className="fr-dash-settings__hint">
              Deletes the workspace and every board in it, for everyone. This can’t be undone. Export it first if you need a copy; every owner gets a receipt.
            </p>
            <Button variant="danger" icon={Trash2} onClick={() => setDeleting(true)}>
              Delete workspace…
            </Button>
          </div>
        </>
      ) : null}

      <Modal
        open={confirmTransfer}
        onClose={() => setConfirmTransfer(false)}
        title={`Make ${heirName ?? 'them'} the owner?`}
        width={420}
        footer={
          <>
            <Button onClick={() => setConfirmTransfer(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={transfer}>
              Transfer
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--fr-ink-2)' }}>You’ll become an admin of {workspace.name}. Only an owner can make you owner again.</p>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${workspace.name}?`}
        width={440}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={confirmName.trim() !== workspace.name} onClick={remove}>
              Delete forever
            </Button>
          </>
        }
      >
        <p style={{ margin: '0 0 12px', color: 'var(--fr-ink-2)' }}>Every board in it is deleted for everyone. Type the workspace name to confirm.</p>
        <Input aria-label="Workspace name to confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={workspace.name} />
      </Modal>
    </section>
  );
}
