// Freero's few uses of Google's Meet add-ons SDK, in one place. Google's terms let nobody bundle the
// SDK, so it is loaded from where Google serves it (the address its guide gives; only the Meet pages'
// CSP allows it, modules/meet) and typed here with just what Freero calls. Outside Meet it never
// creates a session, and connectMeet says so.
import { api } from '../../api/client';

const SDK_URL = 'https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js';

export interface MeetActivityStartingState {
  mainStageUrl?: string;
  sidePanelUrl?: string;
  additionalData?: string;
}
export interface MeetClient {
  getActivityStartingState(): Promise<MeetActivityStartingState>;
  getFrameOpenReason(): Promise<'UNKNOWN' | 'OPEN_ADDON' | 'START_ACTIVITY' | 'JOIN_ACTIVITY'>;
  startActivity(state?: MeetActivityStartingState): Promise<void>;
}
interface MeetAddonSession {
  createSidePanelClient(): Promise<MeetClient>;
  createMainStageClient(): Promise<MeetClient>;
}
interface MeetGlobal {
  addon: { createAddonSession(o: { cloudProjectNumber: string }): Promise<MeetAddonSession> };
}

let sdk: Promise<MeetGlobal> | null = null;

/** Loads Google's SDK once (it sets window.meet). */
function loadSdk(timeoutMs: number): Promise<MeetGlobal> {
  sdk ??= new Promise<MeetGlobal>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    const timer = window.setTimeout(() => reject(new Error('Google Meet’s SDK did not load')), timeoutMs);
    s.onload = () => {
      window.clearTimeout(timer);
      const meet = (window as unknown as { meet?: MeetGlobal }).meet;
      if (meet?.addon) resolve(meet);
      else reject(new Error('Google Meet’s SDK did not start'));
    };
    s.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Google Meet’s SDK did not load'));
    };
    document.head.append(s);
  });
  return sdk;
}

/**
 * Connects this frame to Meet (once per page), telling Meet the add-on has loaded: the side panel's
 * client or the main stage's. Null when this instance has no add-on, or Meet doesn't answer within
 * `timeoutMs` (the page isn't running inside Meet).
 */
export async function connectMeet(frame: 'sidePanel' | 'mainStage', timeoutMs = 6000): Promise<MeetClient | null> {
  try {
    const { cloudProjectNumber } = await api.meetAddOn();
    if (!cloudProjectNumber) return null;
    const meet = await loadSdk(timeoutMs);
    const session = await Promise.race([
      meet.addon.createAddonSession({ cloudProjectNumber }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Google Meet did not answer')), timeoutMs)),
    ]);
    return frame === 'sidePanel' ? await session.createSidePanelClient() : await session.createMainStageClient();
  } catch {
    return null;
  }
}
