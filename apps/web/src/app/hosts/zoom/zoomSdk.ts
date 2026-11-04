// Freero's few uses of the Zoom Apps SDK (@zoom/appssdk, MIT), in one place. The SDK talks to the Zoom
// client it runs in (Zoom's own browser, or the web client's frame); outside Zoom it never answers,
// and connectZoom says so.
import zoomSdk from '@zoom/appssdk';

/** The Zoom Apps SDK calls these pages make — exactly the list the operator turns on (modules/zoom settings.ts). */
const CAPABILITIES = ['getRunningContext', 'getMeetingUUID', 'getUserContext', 'sendAppInvitationToAllParticipants', 'showAppInvitationDialog', 'openUrl', 'onRunningContextChange', 'onMyUserContextChange'] as const;

export interface ZoomInfo {
  /** 'inMeeting', 'inWebinar', 'inMainClient', … */
  context: string;
  /** Running in Zoom's web client, which frames the app (no first-party session here). */
  framed: boolean;
}

let started: Promise<ZoomInfo | null> | null = null;

const isFramed = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

/** Connects to Zoom once per page; null when Zoom doesn't answer within `timeoutMs` (not inside Zoom). */
export function connectZoom(timeoutMs = 4000): Promise<ZoomInfo | null> {
  started ??= (async () => {
    try {
      const config = await Promise.race([
        zoomSdk.config({ capabilities: [...CAPABILITIES], version: '0.16' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Zoom did not answer')), timeoutMs)),
      ]);
      return { context: String(config.runningContext ?? ''), framed: isFramed() };
    } catch {
      return null;
    }
  })();
  return started;
}

/** The meeting's UUID (the same for everyone in it), or null outside a meeting. */
export async function zoomMeetingUuid(): Promise<string | null> {
  try {
    return (await zoomSdk.getMeetingUUID()).meetingUUID || null;
  } catch {
    return null;
  }
}

/** Whether this person may invite everyone (Zoom lets hosts and co-hosts). */
export async function zoomMayInvite(): Promise<boolean> {
  try {
    const role = (await zoomSdk.getUserContext()).role;
    return role === 'host' || role === 'coHost';
  } catch {
    return false;
  }
}

/** Sends Zoom's app invitation to everyone in the meeting. */
export async function zoomInviteEveryone(): Promise<boolean> {
  try {
    await zoomSdk.sendAppInvitationToAllParticipants();
    return true;
  } catch {
    return false;
  }
}

/** Opens a page in the person's own browser (Zoom's browser can't open windows). */
export async function zoomOpenUrl(url: string): Promise<boolean> {
  try {
    await zoomSdk.openUrl({ url });
    return true;
  } catch {
    return false;
  }
}
