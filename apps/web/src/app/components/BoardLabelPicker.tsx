// A board's classification label in the share dialog (#158): what it is, what it limits, and — for
// whoever manages the board's sharing — a picker of the labels its workspace (and organisation)
// define. The server enforces the label's caps on every way in; this only shows and sets it.
import { useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import type { BoardLabel, BoardLabelSummary, BoardSummary, LabelCaps } from '@freero/shared';
import { Select, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import './BoardLabelPicker.css';

const NONE = '__none__';

/** What a label's caps mean, in plain words (the share dialog and the admin console). */
export function capsText(caps: LabelCaps): string[] {
  const out: string[] = [];
  if (caps.linkSharing === 'none') out.push('no link sharing');
  else if (caps.linkSharing) out.push(`links give at most “can ${caps.linkSharing === 'viewer' ? 'view' : caps.linkSharing === 'commenter' ? 'comment' : 'edit'}”`);
  if (caps.publicLinks === 'signedIn') out.push('no visitors without an account');
  if (caps.externalSharing === 'none') out.push('nobody outside the workspace');
  else if (caps.externalSharing === 'admins') out.push('only admins share outside the workspace');
  if (caps.downloads === 'admins') out.push('only admins export or copy');
  else if (caps.downloads === 'members') out.push('guests can’t export or copy');
  if (caps.viewerExports === 'off') out.push('viewers and commenters never export or copy');
  if (caps.boardEmbeds === 'off') out.push('no embedding on other sites');
  if (caps.liveEmbeds === 'off') out.push('no live embeds');
  if (caps.linkPassword === 'required') out.push('links need a password');
  if (caps.linkMaxDays) out.push(`links expire within ${caps.linkMaxDays} days`);
  return out;
}

export function LabelBadge({ label }: { label: Pick<BoardLabelSummary, 'name' | 'color'> }) {
  return (
    <span className="fr-label-badge" style={{ ['--fr-label' as string]: label.color }}>
      <Tag size={12} aria-hidden />
      {label.name}
    </span>
  );
}

export function BoardLabelPicker({ board, onChange }: { board: BoardSummary; onChange: (b: BoardSummary) => void }) {
  const notify = useToast();
  const manages = board.permissions.manageSharing ?? board.role === 'owner';
  const [labels, setLabels] = useState<BoardLabel[] | null>(null);
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!manages) return;
    api.boardLabels(board.workspaceId).then(
      (r) => {
        setLabels(r.labels);
        setRequired(r.required);
      },
      () => setLabels([]),
    );
  }, [board.workspaceId, manages]);

  const pick = async (id: string) => {
    setBusy(true);
    try {
      const { board: updated } = await api.setBoardLabel(board.id, id === NONE ? null : id);
      onChange(updated);
      notify(updated.label ? `Labelled ${updated.label.name}` : 'Label removed', 'success');
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not change the label', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show: no label, and nothing to pick from.
  if (!board.label && (!manages || !labels?.length)) return null;
  const limits = board.label ? capsText(board.label.caps) : [];
  return (
    <section className="fr-share__settings" aria-label="Classification">
      <h3 className="fr-share__heading">
        <Tag size={14} aria-hidden /> Classification
      </h3>
      {manages && labels?.length ? (
        <Select
          size="sm"
          aria-label="Classification label"
          value={board.label?.id ?? NONE}
          disabled={busy}
          onChange={(v) => void pick(v)}
          options={[...(required ? [] : [{ value: NONE, label: 'No label' }]), ...labels.map((l) => ({ value: l.id, label: l.name }))]}
        />
      ) : board.label ? (
        <LabelBadge label={board.label} />
      ) : null}
      {limits.length ? <p className="fr-share__settings-note">This label limits the board: {limits.join('; ')}.</p> : null}
    </section>
  );
}
