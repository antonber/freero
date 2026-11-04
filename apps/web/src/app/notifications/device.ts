// Notifications on this device (#176): the operating system's own notifications for the inbox's
// new items — in the desktop app (its shell's notification plugin) or a browser that allows them.
// Per device, not per account: what pops up on a laptop is that laptop's business, so the choice
// (on / off, and which types) lives in this browser's storage. The texts are the inbox's, already
// worded by the server in the person's language.
import type { AppNotification, NotificationType } from '@freero/shared';

export interface DevicePrefs {
  on: boolean;
  /** Types turned off on this device. */
  off: NotificationType[];
}

const PREFS_KEY = 'freero:device-notifications';
/** The newest notification already shown (or there when this device started showing them). */
const SHOWN_KEY = 'freero:device-notified-at';

interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}
const tauri = (): TauriInternals | null => (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__) || null;

/** Running inside Freero's desktop app (apps/desktop). */
export const isDesktopApp = (): boolean => tauri() !== null;

/** This device can show notifications at all (desktop app, or a browser with the Notification API). */
export const deviceNotificationsAvailable = (): boolean => isDesktopApp() || (typeof window !== 'undefined' && 'Notification' in window);

export function devicePrefs(): DevicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<DevicePrefs> | null;
    if (raw && typeof raw.on === 'boolean') return { on: raw.on, off: Array.isArray(raw.off) ? raw.off : [] };
  } catch {
    // unreadable: the default
  }
  // The desktop app is installed to be notified; a browser asks first.
  return { on: isDesktopApp(), off: [] };
}

export function setDevicePrefs(p: DevicePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    // Turning it on starts from now: the inbox's backlog never pops up.
    if (p.on && !localStorage.getItem(SHOWN_KEY)) localStorage.setItem(SHOWN_KEY, String(Date.now()));
  } catch {
    // storage refused: the choice lasts until the page closes
  }
}

/** Asks the operating system (or browser) for permission; true when notifications may show. */
export async function askDevicePermission(): Promise<boolean> {
  const shell = tauri();
  try {
    if (shell) {
      if (await shell.invoke('plugin:notification|is_permission_granted')) return true;
      return (await shell.invoke('plugin:notification|request_permission')) === 'granted';
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Which of the inbox's items pop up now: unread, newer than the last one shown, of a type left on,
 * and only while Freero isn't what the person is looking at (the bell already tells them then).
 */
export function toShow(items: readonly AppNotification[], prefs: DevicePrefs, shownUntil: number, looking: boolean): AppNotification[] {
  if (!prefs.on || looking) return [];
  return items.filter((n) => !n.readAt && n.createdAt > shownUntil && !prefs.off.includes(n.type)).sort((a, b) => a.createdAt - b.createdAt);
}

/** Shows the inbox's new items as the device's notifications (see toShow). */
export async function announceOnDevice(items: readonly AppNotification[]): Promise<void> {
  const prefs = devicePrefs();
  if (!prefs.on || !deviceNotificationsAvailable()) return;
  let shownUntil = Number(localStorage.getItem(SHOWN_KEY) ?? 0);
  if (!shownUntil) {
    shownUntil = Date.now();
    localStorage.setItem(SHOWN_KEY, String(shownUntil));
  }
  const looking = document.visibilityState === 'visible' && document.hasFocus();
  const due = toShow(items, prefs, shownUntil, looking);
  if (!due.length) return;
  // Claimed before showing, so another tab of this browser doesn't show them too.
  localStorage.setItem(SHOWN_KEY, String(Math.max(...due.map((n) => n.createdAt))));
  const shell = tauri();
  for (const n of due.slice(-3)) {
    try {
      if (shell) await shell.invoke('plugin:notification|notify', { options: { title: n.title, body: n.body || undefined } });
      else if (Notification.permission === 'granted') {
        const shown = new Notification(n.title, { body: n.body, tag: n.id });
        shown.onclick = () => {
          window.focus();
          window.location.assign(n.link);
        };
      }
    } catch {
      // the system refused this one; the inbox still has it
    }
  }
}
