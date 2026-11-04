// The Zoom App of THIS instance (#168; docs/integrations/zoom.md): what the operator enters in the
// Zoom App Marketplace's build flow (a General app), built from the instance's address. Zoom's
// build flow is filled in by hand (its manifest import is an early preview whose feature fields
// aren't documented), so this is a checklist with exact values rather than a file Zoom imports.
//
// The app runs in Zoom's own browser, which loads /zoom/home (top level, not framed) inside the
// meeting's app panel: the board chooser, then /zoom/b/<id> — the board's public embed. Zoom's
// browser keeps its own cookies, so people sign in to Freero right there (with a password or single
// sign-on); "Invite everyone" sends Zoom's app invitation and records the meeting's board
// (service.ts) so the people who accept it open the same board.

/** The Zoom Apps SDK calls the pages make: each must be turned on in the build flow (Features → Zoom App SDK). */
export const ZOOM_SDK_APIS = [
  'getRunningContext',
  'getMeetingUUID',
  'getUserContext',
  'sendAppInvitationToAllParticipants',
  'showAppInvitationDialog',
  'openUrl',
  'onRunningContextChange',
  'onMyUserContextChange',
] as const;

export const ZOOM_SETTINGS_PATH = '/api/integrations/zoom/app-settings';
export const ZOOM_HOME_PATH = '/zoom/home';
export const ZOOM_INSTALLED_PATH = '/zoom/installed';

export function zoomAppSettings(origin: string, clientId: string) {
  const { host } = new URL(origin);
  return {
    about: `What to enter for Freero's Zoom App (${host}) in the Zoom App Marketplace build flow: developers.zoom.us → Build App → General app. See docs/integrations/zoom.md.`,
    clientId,
    basicInformation: {
      appName: 'Freero',
      managedBy: 'User-managed app',
      oauthRedirectUrl: `${origin}${ZOOM_INSTALLED_PATH}`,
      oauthAllowLists: [`${origin}${ZOOM_INSTALLED_PATH}`],
    },
    features: {
      surface: {
        products: ['Meetings'],
        homeUrl: `${origin}${ZOOM_HOME_PATH}`,
        domainAllowList: [host],
        inClientOAuth: false,
        guestMode: true,
        collaborateMode: false,
      },
      zoomAppSdk: { apis: [...ZOOM_SDK_APIS] },
    },
    scopes: ['zoomapp:inmeeting'],
    listing: {
      shortDescription: 'Open a live Freero whiteboard in your Zoom meeting and invite everyone to it.',
      longDescription:
        'Pick one of your Freero boards (or paste a board link) in the meeting’s app panel. The host can invite everyone in the meeting to open the same board. Each person sees it as Freero shares it with them: people the board is shared with sign in once to edit or comment; boards anyone with the link may view show read-only to everyone else.',
      privacyPolicy: `${origin}/privacy`,
      termsOfUse: `${origin}/terms`,
      support: `${origin}/support`,
      documentation: 'https://github.com/antonber/freero/blob/main/docs/integrations/zoom.md',
    },
  };
}
