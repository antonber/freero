// A team workspace's settings (owners/admins): name, ownership transfer and deletion (owners).
// Policies, security and retention live in the admin console (pages/admin).
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Crown, ShieldCheck, Trash2 } from 'lucide-react';
import type { WorkspaceMember, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Select, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

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
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [heir, setHeir] = useState('');
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(workspace.name);
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
        <h2 className="fr-dash-settings__title">Security, sharing and retention</h2>
        <p className="fr-dash-settings__hint">
          Sharing policies, two-step verification, session limits, single sign-on, provisioning, data retention and export, and the audit log live in the
          admin console.
        </p>
        <div className="fr-dash-settings__row">
          <Link to={`/admin/${encodeURIComponent(workspace.id)}?tab=security`} className="fr-dash-settings__link">
            <ShieldCheck size={16} aria-hidden /> Open the admin console
          </Link>
        </div>
      </div>

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
