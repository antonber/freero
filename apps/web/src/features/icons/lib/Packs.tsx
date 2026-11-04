// Uploading and managing shape packs (#4): the workspace's, for its owners and admins, and anyone's
// own library. The files go up as ONE ZIP through the server's upload checks; the server keeps only
// the sanitised drawings.
import { useRef, useState } from 'react';
import { Pencil, Trash2, Upload } from 'lucide-react';
import { SHAPE_PACK_LIMITS, type ShapePack } from '@freero/shared';
import type { HostShapePacks, Host } from '@engine';
import { Button, IconButton, Input, Modal, SegmentedControl } from '@ui';
import { packFileOf } from './zip';
import { t } from '../messages';

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : t('somethingWentWrong'));

type Audience = 'workspace' | 'personal';

/**
 * "Upload a pack": a name and the SVGs (several files, a folder or a ZIP). Workspace owners and
 * admins (`canShare`) choose who may use it; everyone else adds it to their own library.
 */
export function UploadPack({ host, notify, canShare, onCreated }: { host: HostShapePacks; notify: Host['notify']; canShare: boolean; onCreated(id: string): void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [audience, setAudience] = useState<Audience>(canShare ? 'workspace' : 'personal');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const personal = !canShare || audience === 'personal';
  const close = () => {
    setOpen(false);
    setName('');
    setFiles([]);
  };
  const upload = async () => {
    if (!name.trim() || !files.length) return;
    setBusy(true);
    try {
      const zip = await packFileOf(files);
      if (!zip) throw new Error(t('pickSvgFilesOrA'));
      const { pack, skipped } = await host.create(name.trim(), zip, { personal });
      close();
      onCreated(pack.id);
      notify(skipped.length ? t('packAddedSomeSkipped', { name: pack.name, count: pack.icons.length, skipped: skipped.length }) : t('packAdded', { name: pack.name, count: pack.icons.length }), 'success');
    } catch (e) {
      notify(message(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="secondary" size="sm" icon={Upload} onClick={() => setOpen(true)}>
        {t('uploadAPack')}
      </Button>
      {open && (
        <Modal
          open
          onClose={close}
          title={t('uploadAShapePack')}
          description={personal ? t('svgIconsOnlyYou') : t('svgIconsYourTeamMay')}
          footer={
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={() => void upload()} loading={busy} disabled={!name.trim() || !files.length}>
                {t('upload')}
              </Button>
            </>
          }
        >
          <div className="fr-icons-upload">
            <Input label={t('packName')} value={name} maxLength={SHAPE_PACK_LIMITS.name} placeholder={t('packNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
            {canShare && (
              <SegmentedControl<Audience>
                aria-label={t('whoCanUseIt')}
                size="sm"
                value={audience}
                onChange={setAudience}
                options={[
                  { value: 'workspace', label: t('everyoneInThisWorkspace') },
                  { value: 'personal', label: t('onlyMe') },
                ]}
              />
            )}
            <input
              ref={input}
              type="file"
              accept=".svg,image/svg+xml,.zip,application/zip"
              multiple
              hidden
              onChange={(e) => {
                setFiles([...(e.target.files ?? [])]);
                if (!name.trim() && e.target.files?.length === 1) setName(e.target.files[0].name.replace(/\.(zip|svg)$/i, ''));
              }}
            />
            <Button variant="secondary" icon={Upload} onClick={() => input.current?.click()}>
              {files.length ? t('countFilesChosen', { count: files.length }) : t('chooseSvgFilesOrA')}
            </Button>
            <p className="fr-icons__note">{t('scriptsLinksAndStylesAre', { max: SHAPE_PACK_LIMITS.icons })}</p>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Rename or remove the pack the library is showing. */
export function PackManager({ host, notify, pack, onChanged, onRemoved }: { host: HostShapePacks; notify: Host['notify']; pack: ShapePack; onChanged(): void; onRemoved(): void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(message(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fr-icons-pack">
      {renaming !== null ? (
        <form
          className="fr-icons-pack__rename"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await host.rename(pack.id, renaming.trim());
              setRenaming(null);
              onChanged();
            });
          }}
        >
          <Input autoFocus size="sm" aria-label={t('packName')} value={renaming} maxLength={SHAPE_PACK_LIMITS.name} onChange={(e) => setRenaming(e.target.value)} />
          <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!renaming.trim()}>
            {t('save')}
          </Button>
        </form>
      ) : (
        <>
          <span className="fr-icons-pack__by">{pack.personal ? t('onlyYouSeeThisPack') : pack.createdBy ? t('uploadedByName', { name: pack.createdBy }) : null}</span>
          <IconButton size={32} icon={Pencil} label={t('renamePack')} onClick={() => setRenaming(pack.name)} />
          <IconButton size={32} icon={Trash2} label={t('removePack')} onClick={() => setConfirm(true)} />
        </>
      )}
      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(false)}
          title={t('removeName', { name: pack.name })}
          description={t('iconsAlreadyOnBoardsStay')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await host.remove(pack.id);
                    setConfirm(false);
                    onRemoved();
                  })
                }
              >
                {t('remove')}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
