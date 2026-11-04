// "Join call" in the top bar (KAI-134), shown only when the board has a call link, with who is in
// the call; and the dialog where owners and editors set the link.
import { useEffect, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import type { BoardCall, BoardCallResponse } from '@freero/shared';
import { definePanel, useCollection, usePeers, type Editor, type PanelProps } from '@engine';
import { AvatarStack, Button, IconButton, Input, Modal, SegmentedControl, Tooltip } from '@ui';
import { CALL_COLLECTION, CALL_DIALOG, REV_KEY, callHost, callers, openCall, type CallPresence } from './lib/call';
import { t } from './messages';
import './call.css';

/** The board's call: as the board opened, then re-read whenever someone changes it (the `call` collection's rev). */
function useBoardCall(editor: Editor): BoardCall | null {
  const [call, setCall] = useState<BoardCall | null>(editor.host.board.call ?? null);
  const rev = new Map(useCollection<number>(CALL_COLLECTION)).get(REV_KEY);
  useEffect(() => {
    if (rev === undefined || !editor.host.call) return;
    let cancelled = false;
    editor.host.call.get().then(
      (r) => !cancelled && setCall(r.call),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [editor, rev]);
  return call;
}

function CallButton({ editor }: { editor: Editor }) {
  const call = useBoardCall(editor);
  const peers = usePeers();
  const [joined, setJoined] = useState(false);
  const inCall = callers(peers);
  const people = [...(joined ? [{ id: editor.host.user.id, name: editor.host.user.name, color: editor.host.user.color, avatarUrl: editor.host.user.avatarUrl ?? null }] : []), ...inCall.map((p) => p.user)].filter(
    (u, i, all) => all.findIndex((x) => x.id === u.id) === i,
  );
  const join = () => {
    if (!call) return;
    if (!openCall(call)) return editor.host.notify(t('thisCallLinkCanT'), 'error');
    editor.setPresenceExt({ since: editor.host.serverNow() } satisfies CallPresence);
    setJoined(true);
  };
  const leave = () => {
    editor.setPresenceExt(null);
    setJoined(false);
  };
  if (!call) return null;
  return (
    <div className="fr-call" data-testid="call-button">
      {people.length ? <AvatarStack users={people.map((u) => ({ ...u, src: u.avatarUrl ?? null }))} max={3} size={24} className="fr-call__people" /> : null}
      {joined ? (
        <IconButton icon={PhoneOff} label={t('leaveCallOnTheBoard')} size={32} onClick={leave} />
      ) : (
        <Tooltip content={t('opensCallhostInANew', { callHost: callHost(call) })}>
          <Button size="sm" variant="secondary" icon={Phone} onClick={join}>
            {people.length ? t('joinCallLength', { length: people.length }) : t('joinCall')}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

type Mode = 'link' | 'jitsi' | 'none';

function CallDialog({ editor }: PanelProps) {
  const close = () => editor.closePanel(CALL_DIALOG);
  const [state, setState] = useState<BoardCallResponse | null>(null);
  const [mode, setMode] = useState<Mode>('link');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    editor.host.call?.get().then(
      (r) => {
        setState(r);
        setMode(r.call?.kind ?? (r.jitsiAvailable ? 'jitsi' : 'link'));
        if (r.call?.kind === 'link') setUrl(r.call.url);
      },
      (e) => setError(e instanceof Error ? e.message : t('couldNotLoadTheCall')),
    );
  }, [editor]);

  const save = async () => {
    if (!editor.host.call) return;
    setBusy(true);
    setError(null);
    try {
      await editor.host.call.set(mode === 'jitsi' ? { jitsi: true } : mode === 'link' ? { url: url.trim() } : { url: null });
      editor.collection<number>(CALL_COLLECTION).set(REV_KEY, editor.host.serverNow()); // everyone on the board fetches the new link
      editor.host.notify(mode === 'none' ? t('callLinkRemoved') : t('callLinkSaved'), 'success');
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('couldNotSaveTheCall'));
    } finally {
      setBusy(false);
    }
  };

  const options = [
    { value: 'link' as const, label: t('meetingLink') },
    ...(state?.jitsiAvailable ? [{ value: 'jitsi' as const, label: t('jitsiRoom') }] : []),
    { value: 'none' as const, label: t('noCall') },
  ];
  return (
    <Modal
      open
      onClose={close}
      title={t('callLink2')}
      description={t('freeroHasNoBuiltIn')}
      width={480}
      footer={
        <>
          <Button onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!state || (mode === 'link' && !url.trim())} onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <div className="fr-call-form">
        <SegmentedControl<Mode> aria-label={t('call')} options={options} value={mode} onChange={setMode} />
        {mode === 'link' ? (
          <Input
            aria-label={t('meetingLink')}
            placeholder="https://meet.example.com/your-room"
            value={url}
            autoFocus
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            hint={t('googleMeetZoomMicrosoftTeams')}
          />
        ) : null}
        {mode === 'jitsi' ? <p className="fr-call-form__hint">{t('aJitsiRoomOnlyThis')}</p> : null}
        {mode === 'none' ? <p className="fr-call-form__hint">{t('theJoinCallButtonGoes')}</p> : null}
        {error ? (
          <p className="fr-call-form__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default [
  definePanel({ id: 'call.button', slot: 'topbar-right', order: 25, minRole: 'viewer', Component: CallButton }),
  definePanel({ id: CALL_DIALOG, slot: 'dialog', order: 70, minRole: 'editor', Component: CallDialog }),
];
