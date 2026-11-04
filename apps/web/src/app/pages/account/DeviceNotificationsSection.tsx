// Notifications on this device (#176): the operating system's pop-ups for new inbox items, chosen
// per device (app/notifications/device.ts). Shown where the device can show them: the desktop app,
// or a browser with notifications.
import { useEffect, useState } from 'react';
import type { NotificationTypePref } from '@freero/shared';
import { Toggle } from '@ui';
import { api } from '../../api/client';
import { askDevicePermission, deviceNotificationsAvailable, devicePrefs, isDesktopApp, setDevicePrefs, type DevicePrefs } from '../../notifications/device';
import { Section } from './Section';
import { t as tr } from './messages';

export function DeviceNotificationsSection() {
  const [prefs, setPrefs] = useState<DevicePrefs>(devicePrefs);
  const [types, setTypes] = useState<NotificationTypePref[]>([]);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let live = true;
    api.notificationPrefs().then(
      (p) => live && setTypes(p.types),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (!deviceNotificationsAvailable()) return null;

  const change = (next: DevicePrefs) => {
    setPrefs(next);
    setDevicePrefs(next);
  };
  const turn = async (on: boolean) => {
    if (on && !(await askDevicePermission())) return setBlocked(true);
    setBlocked(false);
    change({ ...prefs, on });
  };
  return (
    <Section
      id="device-notifications"
      title={isDesktopApp() ? tr('notificationsOnThisComputer') : tr('notificationsInThisBrowser')}
      description={tr('popUpsForNewActivity')}
    >
      <div className="fr-acct-prefs">
        <Toggle label={<span className="fr-acct-prefs__label">{tr('showNotificationsOnThisDevice')}</span>} checked={prefs.on} onChange={(on) => void turn(on)} />
        {blocked ? <p className="fr-acct__hint">{tr('notificationsAreBlockedForFreero')}</p> : null}
        <ul className="fr-acct-prefs__types" aria-label={tr('showMeNotificationsAbout')}>
          {types.map((t) => (
            <li key={t.type} className={prefs.on ? undefined : 'is-off'}>
              <Toggle
                size="sm"
                disabled={!prefs.on}
                label={
                  <span className="fr-acct-prefs__type">
                    <span className="fr-acct-prefs__label">{t.label}</span>
                  </span>
                }
                checked={!prefs.off.includes(t.type)}
                onChange={(on) => change({ ...prefs, off: on ? prefs.off.filter((x) => x !== t.type) : [...prefs.off, t.type] })}
              />
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
