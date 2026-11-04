// Settings → Notifications: where notifications reach you besides the inbox (email, Slack once
// connected (#105), this device (#176)), and for each kind, on which of them. Email and Slack are
// the account's (PUT /api/notifications/prefs); this device's switches live in this browser
// (app/notifications/device.ts) and, in the phone apps, on the server that pushes (#177).
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CircleAlert, Mail, MessageSquare, Monitor } from 'lucide-react';
import type { BoardChangesFrequency, NotificationPrefs, NotificationType, NotificationTypePref } from '@freero/shared';
import { Button, SegmentedControl, Spinner, Toggle, useToast } from '@ui';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { askDevicePermission, deviceNotificationsAvailable, devicePrefs, isDesktopApp, isMobileApp, setDevicePrefs, type DevicePrefs } from '../../notifications/device';
import { syncPush } from '../../notifications/push';
import { SettingsSection } from './Section';
import { errorText } from './SecuritySections';
import { groupPath } from './sections';
import { t as tr } from './messages';

type Category = 'comments' | 'sharing' | 'cards' | 'walkthroughs' | 'other';
const CATEGORIES: readonly Category[] = ['comments', 'sharing', 'cards', 'walkthroughs', 'other'];
/** Where each kind is listed. Typed over every kind, so a new one has to pick its heading. */
const CATEGORY: Record<NotificationType, Category> = {
  'comment.mention': 'comments',
  'comment.reply': 'comments',
  'comment.thread': 'comments',
  'board.invite': 'sharing',
  'workspace.invite': 'sharing',
  'access.request': 'sharing',
  'access.response': 'sharing',
  'card.assigned': 'cards',
  'card.due_changed': 'cards',
  'card.due_soon': 'cards',
  'agent.blocked': 'cards',
  'walkthrough.mention': 'walkthroughs',
  'walkthrough.comment': 'walkthroughs',
  'walkthrough.reaction': 'walkthroughs',
  'problem.fixed': 'other',
  'sensitive_data.found': 'other',
  'moderation.action': 'other',
};
// A kind this page doesn't know yet (a newer server): under "Admin and other".
const categoryOf = (type: string): Category => CATEGORY[type as NotificationType] ?? 'other';
function categoryTitle(c: Category): string {
  switch (c) {
    case 'comments': return tr('notif.cat.comments');
    case 'sharing': return tr('notif.cat.sharing');
    case 'cards': return tr('notif.cat.cards');
    case 'walkthroughs': return tr('notif.cat.walkthroughs');
    default: return tr('notif.cat.other');
  }
}

/**
 * "New comments on your boards" (#104) is the one kind people opt into: until `boardComments` is
 * on, the server creates none of them (not even in the inbox), whatever its email / Slack switches say.
 */
const OPT_IN: NotificationType = 'comment.thread';

const DIGEST_OPTIONS: Array<{ value: BoardChangesFrequency; label: string }> = [
  { value: 'off', label: tr('off') },
  { value: 'daily', label: tr('daily') },
  { value: 'weekly', label: tr('weekly') },
];

type PrefsPatch = Parameters<typeof api.setNotificationPrefs>[0];

/** This device's pop-ups: on / off and which kinds, with the browser's permission asked first. */
function useDeviceNotifications() {
  const [prefs, setPrefs] = useState<DevicePrefs>(devicePrefs);
  const [blocked, setBlocked] = useState(false);
  const [noPush, setNoPush] = useState(false);
  const change = (next: DevicePrefs) => {
    setPrefs(next);
    setDevicePrefs(next);
    // #177: the apps' choice lives on the server too, which sends the push notifications.
    if (isMobileApp())
      void syncPush(next).then((s) => {
        setBlocked(s === 'blocked');
        setNoPush(s === 'unavailable');
        if (s === 'blocked') {
          setPrefs({ ...next, on: false });
          setDevicePrefs({ ...next, on: false });
        }
      });
  };
  const turn = async (on: boolean) => {
    if (on && !isMobileApp() && !(await askDevicePermission())) return setBlocked(true);
    setBlocked(false);
    change({ ...prefs, on });
  };
  const setType = (type: NotificationType, on: boolean) => change({ ...prefs, off: on ? prefs.off.filter((x) => x !== type) : [...prefs.off, type] });
  const name = isDesktopApp() ? tr('notif.thisComputer') : isMobileApp() ? tr('notif.thisDevice') : tr('notif.thisBrowser');
  return { available: deviceNotificationsAvailable(), name, prefs, blocked, noPush, turn, setType };
}

export function NotificationsSections() {
  const { user } = useAuth();
  const notify = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const device = useDeviceNotifications();

  useEffect(() => {
    let live = true;
    api.notificationPrefs().then(
      (p) => live && setPrefs(p),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!user) return null;
  if (failed || !prefs)
    return (
      <SettingsSection id="notifications" title={tr('notif.channelsTitle')}>
        {failed ? <p className="fr-acct__hint">{tr('notif.couldNotLoad')}</p> : <Spinner size={20} />}
      </SettingsSection>
    );

  const save = async (patch: PrefsPatch, optimistic: NotificationPrefs) => {
    const before = prefs;
    setPrefs(optimistic);
    try {
      setPrefs(await api.setNotificationPrefs(patch));
    } catch (err) {
      setPrefs(before);
      notify(errorText(err, tr('notif.couldNotSave')), 'error');
    }
  };
  const setType = (t: NotificationTypePref, channel: 'email' | 'slack', on: boolean) =>
    save({ [channel]: { [t.type]: on } }, { ...prefs, types: prefs.types.map((x) => (x.type === t.type ? { ...x, [channel]: on } : x)) });
  const setOptIn = (on: boolean) => save({ boardComments: on }, { ...prefs, boardComments: on });

  const slackLinked = !!prefs.slack?.linked;
  const columns = 1 + (slackLinked ? 1 : 0) + (device.available ? 1 : 0);
  const rowsOf = (c: Category) => prefs.types.filter((t) => categoryOf(t.type) === c);

  const row = (t: NotificationTypePref) => {
    const optIn = t.type === OPT_IN;
    const off = optIn && prefs.boardComments !== true;
    return (
      <tr key={t.type} data-testid={`notif-${t.type}`}>
        <th scope="row" className="fr-acct-ntable__kind">
          <div className="fr-acct-ntable__text">
            <span className="fr-acct-ntable__label">{t.label}</span>
            <span className="fr-acct__hint">{t.description}</span>
            {optIn && !off ? (
              <button type="button" className="fr-acct-ntable__optout" aria-label={tr('notif.turnOffLabel', { label: t.label })} onClick={() => void setOptIn(false)}>
                {tr('notif.turnOff')}
              </button>
            ) : null}
          </div>
        </th>
        {off ? (
          <td colSpan={columns} className="fr-acct-ntable__optin">
            <Button size="sm" aria-label={tr('notif.turnOnLabel', { label: t.label })} onClick={() => void setOptIn(true)}>
              {tr('notif.turnOn')}
            </Button>
          </td>
        ) : (
          <>
            <td className={prefs.emailAll ? undefined : 'is-off'}>
              <Toggle size="sm" aria-label={tr('emailLabel', { label: t.label })} disabled={!prefs.emailAll} checked={t.email} onChange={(on) => void setType(t, 'email', on)} />
            </td>
            {slackLinked ? (
              <td>
                <Toggle size="sm" aria-label={tr('slackLabel', { label: t.label })} checked={t.slack} onChange={(on) => void setType(t, 'slack', on)} />
              </td>
            ) : null}
            {device.available ? (
              <td className={device.prefs.on ? undefined : 'is-off'}>
                <Toggle
                  size="sm"
                  aria-label={tr('notif.deviceLabel', { device: device.name, label: t.label })}
                  disabled={!device.prefs.on}
                  checked={!device.prefs.off.includes(t.type)}
                  onChange={(on) => device.setType(t.type, on)}
                />
              </td>
            ) : null}
          </>
        )}
      </tr>
    );
  };

  return (
    <>
      <SettingsSection id="notifications" title={tr('notif.channelsTitle')}>
        <ul className="fr-acct-channels">
          <Channel icon={<Bell size={17} />} name={tr('notif.inbox')} hint={tr('notif.inboxHint')}>
            <span className="fr-acct-badge fr-acct-badge--neutral">{tr('notif.alwaysOn')}</span>
          </Channel>
          <Channel
            icon={<Mail size={17} />}
            name={tr('email')}
            hint={tr('notif.emailHint')}
            note={
              !user.emailVerified ? (
                <p className="fr-acct-prefs__note">
                  <CircleAlert size={15} aria-hidden /> <span>{tr('notif.confirmEmail')}{' '}<Link to={`${groupPath('security')}#email`}>{tr('notif.confirmEmailLink')}</Link></span>
                </p>
              ) : null
            }
          >
            <Toggle aria-label={tr('emailMeAboutActivityI')} checked={prefs.emailAll} onChange={(on) => void save({ emailAll: on }, { ...prefs, emailAll: on })} />
          </Channel>
          <Channel icon={<span className="fr-acct-channel__indent" />} name={tr('changesOnYourBoards')} hint={tr('notif.digestHint')} sub off={!prefs.emailAll}>
            <SegmentedControl<BoardChangesFrequency>
              size="sm"
              value={prefs.boardChanges}
              onChange={(v) => void save({ boardChanges: v }, { ...prefs, boardChanges: v })}
              options={DIGEST_OPTIONS}
              aria-label={tr('emailASummaryOfChanges')}
            />
          </Channel>
          {prefs.slack ? (
            <Channel icon={<MessageSquare size={17} />} name="Slack" hint={slackLinked ? tr('notif.slackHint') : tr('notif.slackOff')}>
              {slackLinked ? (
                <span className="fr-acct-badge fr-acct-badge--ok">{tr('connectedPlain')}</span>
              ) : (
                <Link className="fr-acct-link" to={`${groupPath('integrations')}#slack`}>{tr('connectSlack')}</Link>
              )}
            </Channel>
          ) : null}
          {device.available ? (
            <Channel
              id="device-notifications"
              icon={<Monitor size={17} />}
              name={device.name}
              hint={tr('notif.deviceHint')}
              note={
                <>
                  {device.blocked ? <p className="fr-acct__hint">{tr('notificationsAreBlockedForFreero')}</p> : null}
                  {device.noPush && device.prefs.on ? <p className="fr-acct__hint">{tr('serverSendsNoPush')}</p> : null}
                </>
              }
            >
              <Toggle aria-label={tr('showNotificationsOnThisDevice')} checked={device.prefs.on} onChange={(on) => void device.turn(on)} />
            </Channel>
          ) : null}
        </ul>
      </SettingsSection>
      <SettingsSection id="notification-types" title={tr('notif.typesTitle')} description={tr('notif.typesDescription')}>
        <div className="fr-acct-ntable__wrap">
          <table className="fr-acct-ntable">
            <thead>
              <tr>
                <td />
                <th scope="col">{tr('email')}</th>
                {slackLinked ? <th scope="col">Slack</th> : null}
                {device.available ? <th scope="col">{device.name}</th> : null}
              </tr>
            </thead>
            {CATEGORIES.map((c) => {
              const rows = rowsOf(c);
              if (!rows.length) return null;
              return (
                <tbody key={c}>
                  <tr>
                    <th scope="colgroup" colSpan={columns + 1} className="fr-acct-ntable__cat">
                      {categoryTitle(c)}
                    </th>
                  </tr>
                  {rows.map(row)}
                </tbody>
              );
            })}
          </table>
        </div>
      </SettingsSection>
    </>
  );
}

function Channel({ id, icon, name, hint, note, sub, off, children }: { id?: string; icon: ReactNode; name: string; hint: string; note?: ReactNode; sub?: boolean; off?: boolean; children: ReactNode }) {
  return (
    <li id={id} className={`fr-acct-channel${sub ? ' fr-acct-channel--sub' : ''}${off ? ' is-off' : ''}`}>
      <span className="fr-acct-channel__icon" aria-hidden>
        {icon}
      </span>
      <span className="fr-acct-channel__who">
        <span className="fr-acct-channel__name">{name}</span>
        <span className="fr-acct__hint">{hint}</span>
        {note}
      </span>
      <span className="fr-acct-channel__control">{children}</span>
    </li>
  );
}
