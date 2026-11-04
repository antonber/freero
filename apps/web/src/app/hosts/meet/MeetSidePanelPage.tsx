// Route /meet/sidepanel[?board=<id>] — the Freero add-on's side panel in a Google Meet call (#169).
// Only the person who opened it sees it: they choose a board (Freero's chooser window, or a pasted
// link; it must allow embedding) and open it on the main stage, which starts a Meet activity —
// everyone else in the call is asked to join, and the stage (/meet/stage/<id>) shows each of them the
// board as Freero shares it with them. People who join get this panel with ?board=.
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LayoutGrid, MonitorUp } from 'lucide-react';
import { Button, Logo, Spinner, useToast } from '@ui';
import { LinkOrChoose, type ChosenBoard } from '../LinkOrChoose';
import { t } from '../messages';
import { connectMeet, type MeetClient } from './meetSdk';
import '../../board/BoardPage.css';
import '../hosts.css';

const stageUrl = (id: string) => `${window.location.origin}/meet/stage/${encodeURIComponent(id)}`;
const panelUrl = (id: string) => `${window.location.origin}/meet/sidepanel?board=${encodeURIComponent(id)}`;

export default function MeetSidePanelPage() {
  const toast = useToast();
  const [client, setClient] = useState<MeetClient | null | undefined>(undefined);
  const [chosen, setChosen] = useState<ChosenBoard | null>(null);
  const [onStage, setOnStage] = useState<string | null>(() => new URLSearchParams(window.location.search).get('board'));
  const [starting, setStarting] = useState(false);

  useEffect(() => void connectMeet('sidePanel').then(setClient), []);

  const start = useCallback(async () => {
    if (!client || !chosen) return;
    setStarting(true);
    try {
      await client.startActivity({ mainStageUrl: stageUrl(chosen.id), sidePanelUrl: panelUrl(chosen.id) });
      setOnStage(chosen.id);
    } catch {
      toast(t('couldNotStart'), 'error');
    } finally {
      setStarting(false);
    }
  }, [client, chosen, toast]);

  if (client === undefined) return <Shell><Spinner size={22} label={t('connectingToMeet')} /></Shell>;
  if (client === null)
    return (
      <Shell title={t('openThisInMeet')}>
        <p>{t('openThisInMeetText')}</p>
        <div className="fr-boarderror__actions">
          <Button icon={ExternalLink} onClick={() => void window.open('/app', '_blank', 'noopener')}>{t('openFreero')}</Button>
        </div>
      </Shell>
    );
  const head = (
    <div className="fr-hostpage__head">
      <Logo size={28} />
      <h1>{t('showABoardInCall')}</h1>
    </div>
  );
  if (onStage)
    return (
      <div className="fr-hostpage">
        {head}
        <p className="fr-hostpage__lead">{chosen?.title ? t('onTheStage', { title: chosen.title }) : t('onTheStageUntitled')}</p>
        <div className="fr-hostpage__row">
          <Button icon={ExternalLink} onClick={() => void window.open(`/board/${encodeURIComponent(onStage)}`, '_blank', 'noopener')}>{t('openFreero')}</Button>
          <Button variant="ghost" icon={LayoutGrid} onClick={() => (setOnStage(null), setChosen(null))}>{t('otherBoard')}</Button>
        </div>
      </div>
    );
  return (
    <div className="fr-hostpage">
      {head}
      <p className="fr-hostpage__lead">{t('everyoneSeesItAsShared')}</p>
      {chosen ? (
        <>
          <p className="fr-hostpage__lead">{chosen.title ? t('readyToShow', { title: chosen.title }) : t('readyToShowUntitled')}</p>
          <div className="fr-hostpage__row">
            <Button variant="primary" icon={MonitorUp} loading={starting} onClick={() => void start()}>{t('openOnStage')}</Button>
            <Button variant="ghost" onClick={() => setChosen(null)}>{t('otherBoard')}</Button>
          </div>
          <p className="fr-hostpick__warn">{t('othersAreAsked')}</p>
        </>
      ) : (
        <LinkOrChoose onReady={setChosen} />
      )}
    </div>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        {title ? <h1>{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}
