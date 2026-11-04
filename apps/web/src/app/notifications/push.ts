// Push notifications in Freero's phone and tablet apps (#177). The device's choice ("Notifications
// on this device": on / off, which types — device.ts) is registered with the server together with
// the device's push token, for the account and session signed in here: the server sends each new
// notification of a type left on, and forgets the device when this session ends. In a browser and
// in the desktop app nothing here runs (they show notifications themselves, device.ts).
import { api } from '../api/client';
import { appPathFor, appPlugin, mobilePlatform, pushPath, pushPlugin } from '../mobile/native';
import type { DevicePrefs } from './device';

const TOKEN_KEY = 'freero:push-token';
const TOKEN_TIMEOUT_MS = 15_000;

export type PushState = 'on' | 'off' | 'blocked' | 'unavailable';

let tokenRequest: Promise<string | null> | null = null;

/** The device's push token (asks the system to register once per launch). */
function deviceToken(): Promise<string | null> {
  const push = pushPlugin();
  if (!push) return Promise.resolve(null);
  tokenRequest ??= new Promise<string | null>((resolve) => {
    const done = (t: string | null) => {
      clearTimeout(timer);
      resolve(t);
    };
    const timer = setTimeout(() => done(null), TOKEN_TIMEOUT_MS);
    void push.addListener('registration', (t) => done(t.value));
    void push.addListener('registrationError', () => done(null));
    void push.register().catch(() => done(null));
  }).then((t) => {
    if (!t) tokenRequest = null; // try again next time
    return t;
  });
  return tokenRequest;
}

/**
 * Makes the server's registration of this device match `prefs`: registered with the types left
 * on, or forgotten. Asks the system for permission when turning on.
 */
export async function syncPush(prefs: DevicePrefs): Promise<PushState> {
  const platform = mobilePlatform();
  const push = pushPlugin();
  if (!platform || !push) return 'unavailable';
  try {
    if (!(await api.mobilePushStatus())[platform]) return 'unavailable';
    if (!prefs.on) {
      const old = localStorage.getItem(TOKEN_KEY);
      if (old) await api.unregisterPushDevice(old);
      localStorage.removeItem(TOKEN_KEY);
      return 'off';
    }
    let permission = (await push.checkPermissions()).receive;
    if (permission === 'prompt' || permission === 'prompt-with-rationale') permission = (await push.requestPermissions()).receive;
    if (permission !== 'granted') return 'blocked';
    const token = await deviceToken();
    if (!token) return 'unavailable';
    await api.registerPushDevice({ platform, token, off: prefs.off });
    localStorage.setItem(TOKEN_KEY, token);
    return 'on';
  } catch {
    return 'unavailable';
  }
}

let started = false;

/**
 * Once per launch in the apps: links the app was opened with (freero://…, https links to this
 * server's boards and docs) and tapped notifications open their page here.
 */
export function startMobileApp(navigate: (path: string) => void): void {
  if (started || !mobilePlatform()) return;
  started = true;
  void appPlugin()?.addListener('appUrlOpen', ({ url }) => {
    const path = appPathFor(url, window.location.origin);
    if (path) navigate(path);
  });
  void pushPlugin()?.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const path = pushPath(notification.data);
    if (path) navigate(path);
  });
}
