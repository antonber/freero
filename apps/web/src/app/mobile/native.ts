// Freero's phone and tablet apps (#177, apps/mobile): the Capacitor shell loads this web app from
// the server and adds its bridge (`window.Capacitor`) with the plugins it was built with — push
// notifications and the app's links. Nothing here is bundled from Capacitor: the shell's own
// bridge is the only way in, so a browser never loads any of it.

export interface PushToken {
  value: string;
}
export interface PushAction {
  notification: { data?: Record<string, unknown> };
}
interface Listener {
  remove(): Promise<void> | void;
}
interface PushNotificationsPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  unregister?(): Promise<void>;
  addListener(event: 'registration', fn: (t: PushToken) => void): Promise<Listener>;
  addListener(event: 'registrationError', fn: (e: unknown) => void): Promise<Listener>;
  addListener(event: 'pushNotificationActionPerformed', fn: (a: PushAction) => void): Promise<Listener>;
}
interface AppPlugin {
  addListener(event: 'appUrlOpen', fn: (e: { url: string }) => void): Promise<Listener>;
}
interface CapacitorBridge {
  isNativePlatform(): boolean;
  getPlatform(): string;
  Plugins: { PushNotifications?: PushNotificationsPlugin; App?: AppPlugin };
}

const bridge = (): CapacitorBridge | null => {
  if (typeof window === 'undefined') return null;
  const c = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() ? c : null;
};

/** 'ios' / 'android' inside Freero's phone and tablet apps; null in a browser or the desktop app. */
export function mobilePlatform(): 'ios' | 'android' | null {
  const p = bridge()?.getPlatform();
  return p === 'ios' || p === 'android' ? p : null;
}

export const pushPlugin = (): PushNotificationsPlugin | null => bridge()?.Plugins.PushNotifications ?? null;
export const appPlugin = (): AppPlugin | null => bridge()?.Plugins.App ?? null;

/**
 * The app path a link opened in the app shows: `freero://board/<id>?item=…`, `freero://doc/<id>`,
 * `freero://app`, or an https link to this server's boards and docs. Anything else (another site, a
 * path outside the app) is null: it never opens inside the app.
 */
export function appPathFor(url: string, origin: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let path: string;
  if (u.protocol === 'freero:') path = `/${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  else if (u.origin === origin) path = u.pathname;
  else return null;
  if (path === '/app') return `/app${u.search}`;
  return /^\/(board|doc)\/[A-Za-z0-9_-]{1,64}$/.test(path) ? `${path}${u.search}` : null;
}

/** A pushed notification's page (the server sends its app path as `path`). */
export function pushPath(data: Record<string, unknown> | undefined): string | null {
  const p = data?.path;
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : null;
}
