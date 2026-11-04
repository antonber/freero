// Settings → Slack (#105): connect your own Slack account through the server operator's Slack app,
// or disconnect it. Hidden when the server doesn't offer it. Connecting is a page visit to Slack's
// consent and back (the server binds it to this browser); the result arrives as ?slack=connected
// or ?slack_error=… on /settings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquareShare, Unplug } from 'lucide-react';
import type { SlackAccountInfo } from '@freero/shared';
import { Button, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { Section } from './Section';

const CONNECT_URL = '/api/integrations/slack/oauth/start';

export function SlackSection({ onChange }: { onChange: () => void }) {
  const notify = useToast();
  const [info, setInfo] = useState<SlackAccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const back = useRef(false);
  const load = useCallback(() => {
    api.slackAccount().then(setInfo, () => setInfo({ offered: false, link: null }));
  }, []);
  useEffect(load, [load]);

  // Back from Slack's consent: say how it went once, then drop it from the address.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('slack_error');
    if (!err && !q.get('slack')) return;
    if (err) notify(err, 'error');
    else if (q.get('slack') === 'connected') notify('Slack connected', 'success');
    q.delete('slack_error');
    q.delete('slack');
    const rest = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    back.current = true;
  }, [notify]);
  // …and show the section once it is there (it renders after the account loads).
  useEffect(() => {
    if (!info?.offered || !back.current) return;
    back.current = false;
    document.getElementById('slack')?.scrollIntoView({ block: 'start' });
  }, [info]);

  if (!info?.offered) return null;
  const disconnect = async () => {
    setBusy(true);
    try {
      await api.disconnectSlack();
      notify('Slack disconnected', 'success');
      load();
      onChange();
    } catch (e) {
      notify(e instanceof ApiError && e.status < 500 ? e.message : 'Could not disconnect Slack', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      id="slack"
      title="Slack"
      description="Get your notifications as direct messages from Freero’s Slack app, show what a board is when you paste a link to it in Slack, and create or find boards with /freero."
    >
      {info.link ? (
        <div className="fr-acct-slack">
          <p className="fr-acct-slack__who">
            Connected as <strong>{info.link.slackName}</strong> in <strong>{info.link.teamName}</strong>.
          </p>
          <p className="fr-acct__hint">
            In Slack, type <code>/freero new Sprint review</code> to create a board, or <code>/freero roadmap</code> to find yours. Choose which notifications
            come to Slack under Notification emails and Slack above — those arrive in Slack instead of by email.
          </p>
          <div className="fr-acct-form__row">
            <Button variant="secondary" icon={Unplug} onClick={disconnect} disabled={busy}>
              Disconnect Slack
            </Button>
          </div>
        </div>
      ) : (
        <div className="fr-acct-form__row">
          <Button variant="primary" icon={MessageSquareShare} onClick={() => window.location.assign(CONNECT_URL)}>
            Connect Slack
          </Button>
        </div>
      )}
    </Section>
  );
}
