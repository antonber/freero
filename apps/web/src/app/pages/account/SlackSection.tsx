// Settings → Slack (#105): connect your own Slack account through the server operator's Slack app,
// or disconnect it. Hidden when the server doesn't offer it. Connecting is a page visit to Slack's
// consent and back (the server binds it to this browser); the result arrives as ?slack=connected
// or ?slack_error=… on /settings (#slack), which opens Integrations here (sections.ts).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareShare, Unplug } from 'lucide-react';
import type { SlackAccountInfo } from '@freero/shared';
import { Button, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { SettingsSection } from './Section';
import { groupPath } from './sections';

import { t } from './messages';
const CONNECT_URL = '/api/integrations/slack/oauth/start';

export function SlackSection() {
  const notify = useToast();
  const [info, setInfo] = useState<SlackAccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
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
    else if (q.get('slack') === 'connected') notify(t('slackConnected'), 'success');
    q.delete('slack_error');
    q.delete('slack');
    const rest = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  }, [notify]);

  if (!info?.offered) return null;
  const disconnect = async () => {
    setBusy(true);
    try {
      await api.disconnectSlack();
      notify(t('slackDisconnected'), 'success');
      load();
    } catch (e) {
      notify(e instanceof ApiError && e.status < 500 ? e.message : t('couldNotDisconnectSlack'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection id="slack" title="Slack" description={t('slack.description')}>
      {info.link ? (
        <div className="fr-acct-slack">
          <p className="fr-acct-slack__who">{t('connectedAs')}{' '}<strong>{info.link.slackName}</strong>{' '}{t('in')}{' '}<strong>{info.link.teamName}</strong>.
          </p>
          <p className="fr-acct__hint">{t('inSlackType')}{' '}<code>/freero new Sprint review</code>{' '}{t('toCreateABoardOr')}{' '}<code>/freero roadmap</code>{' '}{t('slack.toFindYours')}</p>
          <p className="fr-acct__hint">
            <Link to={groupPath('notifications')}>{t('slack.chooseNotifications')}</Link>
          </p>
          <div className="fr-acct-form__row">
            <Button variant="secondary" icon={Unplug} onClick={disconnect} disabled={busy}>{t('disconnectSlack')}</Button>
          </div>
        </div>
      ) : (
        <div className="fr-acct-form__row">
          <Button variant="primary" icon={MessageSquareShare} onClick={() => window.location.assign(CONNECT_URL)}>{t('connectSlack')}</Button>
        </div>
      )}
    </SettingsSection>
  );
}
