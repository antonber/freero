// "Save as template" dialog: the whole board or the current selection, with a name, a
// description and a live preview of what will be saved.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookmarkPlus } from 'lucide-react';
import type { Editor, PanelProps } from '@engine';
import { Button, Input, Modal, SegmentedControl, Spinner, TextArea, Toggle } from '@ui';
import { DOCK_ID } from './insert';
import { SAVE_DIALOG_ID, saveAsTemplate } from './saved';

import { t } from '../messages';
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
    if (!n) return setError(t('giveYourTemplateAName'));
    setBusy(true);
    try {
      const saved = await saveAsTemplate(editor, { ids, name: n, description: description.trim(), shareWithTeam: !!team && shareWithTeam });
      close();
      editor.host.notify(saved.shared && team ? t('savedNameAndSharedIt', { name: saved.name, name2: team.name }) : t('savedNameToYourTemplates', { name: saved.name }), 'success', {
        action: { label: t('view'), run: () => editor.openDock(DOCK_ID) },
      });
    } catch (err) {
      editor.host.notify(err instanceof Error && err.message ? err.message : t('couldNotSaveTheTemplate'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : close}
      title={t('saveAsTemplate2')}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" icon={BookmarkPlus} loading={busy} disabled={busy || count === 0} onClick={() => submit()}>{t('saveTemplate')}</Button>
        </>
      }
    >
      <form className="fr-tpl-save" onSubmit={submit} noValidate>
        {selection.length > 0 ? (
          <SegmentedControl<Scope>
            aria-label={t('whatToSave')}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'board', label: t('wholeBoard') },
              { value: 'selection', label: t('selection') },
            ]}
          />
        ) : null}
        <div className="fr-tpl-save__preview" aria-label={t('preview')}>
          {preview === 'loading' ? <Spinner size={20} /> : preview ? <img src={preview} alt="" /> : <span>{t('nothingToPreview')}</span>}
        </div>
        <p className="fr-tpl-save__count">
          {count === 0 ? t('thisBoardIsEmptyAdd') : `${count} ${count === 1 ? 'item' : 'items'}`}
        </p>
        <Input
          label={t('name')}
          autoFocus
          maxLength={80}
          value={name}
          placeholder={t('eGWeeklyTeamRetro')}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        <TextArea
          label={t('description')}
          maxLength={500}
          rows={3}
          value={description}
          placeholder={t('whatIsItForOptional')}
          onChange={(e) => setDescription(e.target.value)}
        />
        {team ? <Toggle checked={shareWithTeam} onChange={setShareWithTeam} label={t('shareWithName', { name: team.name })} /> : null}
        <p className="fr-tpl-save__note">
          {team && shareWithTeam
            ? t('everyoneInNameNotGuests', { name: team.name })
            : t('onlyYouCanSeeYour')}
        </p>
      </form>
    </Modal>
  );
}
