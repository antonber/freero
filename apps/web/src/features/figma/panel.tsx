// "Place from Figma…": connect your Figma account once, open a file (a link, or one used before),
// tick frames, place them. Each frame is rendered by Figma and copied into your uploads, so
// everyone who can open the board sees it, Figma access or not.
import { useEffect, useState } from 'react';
import { Check, Frame, Link2 } from 'lucide-react';
import { parseFigmaLink, type FigmaFile, type FigmaFramesResponse, type FigmaStatus } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, Input, Modal, Spinner } from '@ui';
import { DIALOG, figmaErrorText, needsConnect, placeFrames } from './lib/frames';
import { t } from './messages';
import './figma.css';

function FigmaPicker({ editor }: PanelProps) {
  const figma = editor.host.figma;
  const close = () => editor.closePanel(DIALOG);
  const [status, setStatus] = useState<FigmaStatus | null>(null);
  const [recent, setRecent] = useState<FigmaFile[]>([]);
  const [link, setLink] = useState('');
  const [file, setFile] = useState<FigmaFramesResponse | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<'status' | 'file' | 'place' | null>('status');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!figma) return;
    let live = true;
    void figma
      .status()
      .then(async (s) => {
        if (!live) return;
        setStatus(s);
        if (s.connected) setRecent((await figma.recentFiles()).files);
      })
      .catch((e) => live && setError(figmaErrorText(e)))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [figma]);

  if (!figma) return null;

  const fail = (e: unknown) => {
    if (needsConnect(e)) setStatus({ connected: null });
    setError(figmaErrorText(e));
  };

  const open = async (fileKey: string, nodeId: string | null = null) => {
    setBusy('file');
    setError(null);
    try {
      const f = await figma.frames(fileKey);
      setFile(f);
      setPicked(nodeId && f.frames.some((fr) => fr.id === nodeId) ? [nodeId] : []);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const openLink = () => {
    const parsed = parseFigmaLink(link);
    if (!parsed) return setError(t('notAFigmaLink'));
    void open(parsed.fileKey, parsed.nodeId);
  };

  const place = async () => {
    if (!file || !picked.length) return;
    setBusy('place');
    setError(null);
    const placed = [];
    try {
      for (const id of picked) {
        const frame = file.frames.find((f) => f.id === id)!;
        placed.push({ frame, stored: await figma.place(file.file.key, id) });
      }
    } catch (e) {
      fail(e);
    }
    const ids = placeFrames(editor, placed);
    setBusy(null);
    if (ids.length) {
      editor.host.notify(t('placed', { count: ids.length }), 'success');
      if (ids.length === picked.length) close();
    }
  };

  const disconnect = async () => {
    await figma.disconnect().catch(() => undefined);
    setStatus({ connected: null });
    setFile(null);
    setRecent([]);
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  let body;
  if (busy === 'status') body = <Spinner />;
  else if (!status?.connected)
    body = (
      <div className="fr-figma__connect">
        <p>{t('connectExplainer')}</p>
        <Button variant="primary" onClick={() => figma.connect()}>
          {t('connectFigma')}
        </Button>
      </div>
    );
  else
    body = (
      <div className="fr-figma">
        <div className="fr-figma__account">
          <span>{t('signedInAs', { handle: status.connected.handle })}</span>
          <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
            {t('disconnect')}
          </Button>
        </div>
        <form
          className="fr-figma__open"
          onSubmit={(e) => {
            e.preventDefault();
            openLink();
          }}
        >
          <Input icon={Link2} label={t('fileLink')} placeholder={t('linkPlaceholder')} value={link} onChange={(e) => setLink(e.target.value)} />
          <Button type="submit" loading={busy === 'file'} disabled={!link.trim()}>
            {t('open')}
          </Button>
        </form>
        {!file && recent.length ? (
          <section aria-label={t('recentFiles')}>
            <h3 className="fr-figma__heading">{t('recentFiles')}</h3>
            <ul className="fr-figma__files">
              {recent.map((f) => (
                <li key={f.key}>
                  <button type="button" className="fr-figma__file" onClick={() => void open(f.key)} disabled={busy !== null}>
                    {f.thumbnail ? <img src={f.thumbnail} alt="" /> : <Frame size={20} aria-hidden />}
                    <span>{f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {file ? (
          <section aria-label={file.file.name}>
            <div className="fr-figma__file-head">
              <h3 className="fr-figma__heading">{file.file.name}</h3>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                {t('otherFile')}
              </Button>
            </div>
            {file.frames.length ? (
              <ul className="fr-figma__frames">
                {file.frames.map((f) => {
                  const on = picked.includes(f.id);
                  return (
                    <li key={f.id}>
                      <button type="button" className="fr-figma__frame" aria-pressed={on} onClick={() => toggle(f.id)}>
                        <span className="fr-figma__thumb">{f.preview ? <img src={f.preview} alt="" /> : <Frame size={24} aria-hidden />}</span>
                        <span className="fr-figma__name">{f.name}</span>
                        <span className="fr-figma__page">{f.page}</span>
                        {on ? <Check className="fr-figma__tick" size={16} aria-hidden /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="fr-figma__hint">{t('noFrames')}</p>
            )}
            {file.more ? <p className="fr-figma__hint">{t('moreFrames')}</p> : null}
          </section>
        ) : null}
      </div>
    );

  return (
    <Modal
      open
      onClose={close}
      title={t('placeFromFigma2')}
      description={t('pickerDescription')}
      width={640}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('cancel')}
          </Button>
          {status?.connected ? (
            <Button variant="primary" loading={busy === 'place'} disabled={!picked.length || busy !== null} onClick={() => void place()}>
              {t('placeFrames', { count: picked.length })}
            </Button>
          ) : null}
        </>
      }
    >
      {body}
      {error ? (
        <p className="fr-figma__error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export default definePanel({ id: DIALOG, slot: 'dialog', order: 94, minRole: 'editor', Component: FigmaPicker });
