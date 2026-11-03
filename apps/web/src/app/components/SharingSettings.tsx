// A board's own sharing settings in the share dialog (#123): its owner and co-owners decide whether
// editors may invite people and whether viewers and commenters may copy, export and download it.
// The server enforces both (and caps them by the workspace's policies); this only shows and sets them.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { BoardSharingSettings, BoardSummary } from '@freero/shared';
import { Toggle, useToast } from '@ui';
import { api, ApiError } from '../api/client';

const DEFAULTS: BoardSharingSettings = { editorsCanShare: true, viewersCanExport: true };

export function SharingSettings({ board, onChange }: { board: BoardSummary; onChange: (b: BoardSummary) => void }) {
  const notify = useToast();
  const manages = board.permissions.manageSharing ?? board.role === 'owner';
  const settings = board.sharing ?? DEFAULTS;
  const [busy, setBusy] = useState(false);

  const set = async (patch: Partial<BoardSharingSettings>, done: string) => {
    setBusy(true);
    try {
      const { board: updated } = await api.updateBoard(board.id, { sharing: patch });
      onChange(updated);
      notify(done, 'success');
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not change the sharing settings', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fr-share__settings" aria-label="Sharing settings">
      <h3 className="fr-share__heading">
        <ShieldCheck size={14} aria-hidden /> Sharing settings
      </h3>
      <Toggle
        size="sm"
        label="Editors can invite people"
        checked={settings.editorsCanShare}
        disabled={!manages || busy}
        onChange={(on) => void set({ editorsCanShare: on }, on ? 'Editors can invite people again' : 'Only owners and co-owners can invite people now')}
      />
      <Toggle
        size="sm"
        label="Viewers and commenters can copy, export and download"
        checked={settings.viewersCanExport}
        disabled={!manages || busy}
        onChange={(on) => void set({ viewersCanExport: on }, on ? 'Viewers and commenters can copy and export again' : 'Viewers and commenters can no longer copy or export')}
      />
      <p className="fr-share__settings-note">
        {manages ? 'Only the owner and co-owners change these; the workspace’s policies still apply on top. ' : ''}
        Nothing stops someone from taking a screenshot of what they can see.
      </p>
    </section>
  );
}
