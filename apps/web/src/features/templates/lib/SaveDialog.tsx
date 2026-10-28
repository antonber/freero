// "Save as template" dialog: the whole board or the current selection, with a name, a
// description and a live preview of what will be saved.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookmarkPlus } from 'lucide-react';
import type { Editor, PanelProps } from '@engine';
import { Button, Input, Modal, SegmentedControl, Spinner, TextArea, Toggle } from '@ui';
import { DOCK_ID } from './insert';
import { SAVE_DIALOG_ID, saveAsTemplate } from './saved';

type Scope = 'board' | 'selection';

function usePreview(editor: Editor, ids: string[] | undefined): string | null | 'loading' {
  const [url, setUrl] = useState<string | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    setUrl('loading');
    const b = editor.getBounds(ids, { visual: true });
    if (!b) {
      setUrl(null);
      return;
    }
    const scale = Math.min(1, 560 / Math.max(b.w, b.h, 1));
    editor
      .renderToDataUrl({ ids, format: 'png', scale, padding: 24, skipFonts: true })
      .then((u) => live && setUrl(u))
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [editor, ids]);
  return url;
}

export function SaveTemplateDialog({ editor, props }: PanelProps) {
  const close = () => editor.closePanel(SAVE_DIALOG_ID);
  const selection = useMemo(() => editor.getSelection(), [editor]);
  const [scope, setScope] = useState<Scope>(() => (props?.scope === 'selection' && selection.length ? 'selection' : 'board'));
  const ids = scope === 'selection' ? selection : undefined;
  const count = useMemo(() => editor.exportElements(ids)?.elements.length ?? 0, [editor, ids]);
  const preview = usePreview(editor, ids);
  const [name, setName] = useState(() => (scope === 'board' ? editor.host.board.title : ''));
  const [description, setDescription] = useState('');
  const team = editor.host.board.team ?? null;
  const [shareWithTeam, setShareWithTeam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n) return setError('Give your template a name');
    setBusy(true);
    try {
      const saved = await saveAsTemplate(editor, { ids, name: n, description: description.trim(), shareWithTeam: !!team && shareWithTeam });
      close();
      editor.host.notify(saved.shared && team ? `Saved “${saved.name}” and shared it with ${team.name}.` : `Saved “${saved.name}” to your templates.`, 'success', {
        action: { label: 'View', run: () => editor.openDock(DOCK_ID) },
      });
    } catch (err) {
      editor.host.notify(err instanceof Error && err.message ? err.message : 'Could not save the template.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : close}
      title="Save as template"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={BookmarkPlus} loading={busy} disabled={busy || count === 0} onClick={() => submit()}>
            Save template
          </Button>
        </>
      }
    >
      <form className="fr-tpl-save" onSubmit={submit} noValidate>
        {selection.length > 0 ? (
          <SegmentedControl<Scope>
            aria-label="What to save"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'board', label: 'Whole board' },
              { value: 'selection', label: 'Selection' },
            ]}
          />
        ) : null}
        <div className="fr-tpl-save__preview" aria-label="Preview">
          {preview === 'loading' ? <Spinner size={20} /> : preview ? <img src={preview} alt="" /> : <span>Nothing to preview</span>}
        </div>
        <p className="fr-tpl-save__count">
          {count === 0 ? 'This board is empty. Add something first.' : `${count} ${count === 1 ? 'item' : 'items'}`}
        </p>
        <Input
          label="Name"
          autoFocus
          maxLength={80}
          value={name}
          placeholder="e.g. Weekly team retro"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        <TextArea
          label="Description"
          maxLength={500}
          rows={3}
          value={description}
          placeholder="What is it for? (optional)"
          onChange={(e) => setDescription(e.target.value)}
        />
        {team ? <Toggle checked={shareWithTeam} onChange={setShareWithTeam} label={`Share with ${team.name}`} /> : null}
        <p className="fr-tpl-save__note">
          {team && shareWithTeam
            ? `Everyone in ${team.name} (not guests) can add it to their boards. You can stop sharing it later.`
            : 'Only you can see your templates. Add them to any board from the Templates panel.'}
        </p>
      </form>
    </Modal>
  );
}
