// Classification labels (#158): the labels boards here may carry and what each one limits, whether a
// label is required, and the label new boards get. An organisation's labels reach all its
// workspaces (listed as inherited there). Content admins; the server enforces every cap.
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BoardLabel, BoardLabelInput, LabelCaps, WorkspaceSummary } from '@freero/shared';
import { Button, ColorSwatches, Input, Modal, Select, Spinner, TextArea, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { capsText, LabelBadge } from '../../components/BoardLabelPicker';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const COLORS = ['#2f9e44', '#1c7ed6', '#f08c00', '#e03131', '#7048e8', '#495057'];
const ANY = '';

type Choice<K extends keyof LabelCaps> = { key: K; label: string; options: Array<{ value: string; label: string }> };
const CHOICES: Array<Choice<keyof LabelCaps>> = [
  { key: 'linkSharing', label: 'Link sharing', options: [{ value: 'none', label: 'Off' }, { value: 'viewer', label: 'At most “can view”' }, { value: 'commenter', label: 'At most “can comment”' }] },
  { key: 'externalSharing', label: 'People outside the workspace', options: [{ value: 'none', label: 'Nobody' }, { value: 'admins', label: 'Only admins share' }] },
  { key: 'downloads', label: 'Export, copy, download', options: [{ value: 'admins', label: 'Owners and admins only' }, { value: 'members', label: 'Members, not guests' }] },
];
const SWITCHES: Array<{ key: keyof LabelCaps; on: string; label: string }> = [
  { key: 'publicLinks', on: 'signedIn', label: 'No visitors without an account' },
  { key: 'viewerExports', on: 'off', label: 'Viewers and commenters never export or copy' },
  { key: 'boardEmbeds', on: 'off', label: 'No embedding on other sites' },
  { key: 'liveEmbeds', on: 'off', label: 'No live embeds of other sites' },
  { key: 'linkPassword', on: 'required', label: 'Links need a password' },
];

export function AdminLabels({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [state, setState] = useState<{ labels: BoardLabel[]; required: boolean; defaultLabelId: string | null } | null>(null);
  const [editing, setEditing] = useState<BoardLabel | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.boardLabels(workspace.id).then(setState, (e) => notify(errorText(e, 'Could not load the labels'), 'error'));
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const policy = async (patch: { required?: boolean; defaultLabelId?: string | null }) => {
    setBusy('policy');
    try {
      await api.setLabelPolicy(workspace.id, patch);
      load();
    } catch (e) {
      notify(errorText(e, 'Could not change it'), 'error');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (l: BoardLabel) => {
    setBusy(l.id);
    try {
      await api.deleteBoardLabel(workspace.id, l.id);
      notify(`Deleted ${l.name}`, 'success');
      load();
    } catch (e) {
      notify(errorText(e, 'Could not delete it'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!state) return <Spinner />;
  const own = state.labels.filter((l) => !l.inherited);
  return (
    <section aria-labelledby="admin-labels-title">
      <div className="fr-admin__head">
        <h1 id="admin-labels-title" className="fr-admin__title">
          Classification
        </h1>
        <span className="fr-admin__muted">
          Labels say how sensitive a board is. Each one can limit sharing and exports beyond what the workspace allows — on links, the API, apps and embeds alike.
        </span>
        <div className="fr-admin__head-actions">
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            New label
          </Button>
        </div>
      </div>
      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">Labels on new boards</h2>
        <div className="fr-admin-labels__policy">
          <Select
            size="sm"
            aria-label="Label new boards get"
            value={state.defaultLabelId ?? ANY}
            disabled={busy === 'policy'}
            onChange={(v) => void policy({ defaultLabelId: v || null })}
            options={[{ value: ANY, label: 'No label' }, ...state.labels.map((l) => ({ value: l.id, label: l.name }))]}
          />
          <Toggle
            size="sm"
            label="Every board must carry a label"
            checked={state.required}
            disabled={busy === 'policy'}
            onChange={(on) => void policy({ required: on })}
          />
        </div>
        <p className="fr-admin-card__note">New boards get the default label; with a label required, nobody can take a board’s label off, only change it.</p>
      </div>
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Limits</th>
              <th scope="col">Boards</th>
              <th scope="col">
                <span className="fr-admin__sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.labels.map((l) => (
              <tr key={l.id}>
                <td>
                  <LabelBadge label={l} />
                  {l.inherited ? <span className="fr-admin__muted"> · from the organisation</span> : null}
                  {l.description ? <div className="fr-admin__muted">{l.description}</div> : null}
                </td>
                <td className="fr-admin__muted">{capsText(l.caps).join('; ') || 'Nothing beyond the workspace’s policies'}</td>
                <td>{l.boards ?? 0}</td>
                <td className="fr-admin-table__actions">
                  {!l.inherited ? (
                    <>
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(l)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" icon={Trash2} loading={busy === l.id} onClick={() => void remove(l)}>
                        Delete
                      </Button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {state.labels.length === 0 ? (
              <tr>
                <td colSpan={4} className="fr-admin__muted">
                  No labels yet. A common set: Public, Internal, Confidential.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <LabelEditor
          workspace={workspace}
          label={editing === 'new' ? null : editing}
          taken={own.filter((l) => editing === 'new' || l.id !== editing.id).map((l) => l.name.toLowerCase())}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}

function LabelEditor({ workspace, label, taken, onClose, onSaved }: { workspace: WorkspaceSummary; label: BoardLabel | null; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(label?.color ?? COLORS[0]);
  const [description, setDescription] = useState(label?.description ?? '');
  const [caps, setCaps] = useState<LabelCaps>(label?.caps ?? {});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof LabelCaps, v: string | number | undefined) =>
    setCaps((c) => {
      const next: Record<string, unknown> = { ...c };
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
      return next as LabelCaps;
    });
  const save = async () => {
    setBusy(true);
    const input: BoardLabelInput = { name, color, description, caps };
    try {
      if (label) await api.updateBoardLabel(workspace.id, label.id, input);
      else await api.createBoardLabel(workspace.id, input);
      notify(label ? `Saved ${name}` : `Created ${name}`, 'success');
      onSaved();
    } catch (e) {
      notify(errorText(e, 'Could not save the label'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const duplicate = taken.includes(name.trim().toLowerCase());
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title={label ? `Edit ${label.name}` : 'New label'}
      description="What a board with this label may never do, whatever its workspace or owner allows."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || duplicate} onClick={() => void save()}>
            {label ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="fr-admin-holds__form">
        <Input label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} error={duplicate ? 'There is already a label with that name' : undefined} autoFocus />
        <ColorSwatches colors={COLORS} value={color} onChange={setColor} />
        <TextArea label="Description (optional)" value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} />
        {CHOICES.map((c) => (
          <label key={c.key} className="fr-admin-labels__choice">
            <span>{c.label}</span>
            <Select
              size="sm"
              aria-label={c.label}
              value={(caps[c.key] as string | undefined) ?? ANY}
              onChange={(v) => set(c.key, v)}
              options={[{ value: ANY, label: 'As the workspace allows' }, ...c.options]}
            />
          </label>
        ))}
        {SWITCHES.map((s) => (
          <Toggle key={s.key} size="sm" label={s.label} checked={caps[s.key] === s.on} onChange={(on) => set(s.key, on ? s.on : undefined)} />
        ))}
        <label className="fr-admin-labels__choice">
          <span>Links expire within (days)</span>
          <Input
            size="sm"
            type="number"
            min={1}
            max={365}
            value={caps.linkMaxDays ?? ''}
            onChange={(e) => set('linkMaxDays', e.target.value ? Math.max(1, Math.min(365, Number(e.target.value))) : undefined)}
            aria-label="Links expire within (days)"
          />
        </label>
      </div>
    </Modal>
  );
}
