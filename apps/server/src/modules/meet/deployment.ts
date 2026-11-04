// The Google Meet add-on of THIS instance (#169; docs/integrations/google-meet.md): the deployment
// manifest the operator pastes into the Google Workspace Marketplace SDK (HTTP deployments → Create
// new deployment), built from the instance's address — the format of
// developers.google.com/workspace/meet/add-ons/guides/deploy-add-on.
//
// The side panel (/meet/sidepanel) picks a board and starts an activity (the SDK's startActivity)
// whose main stage is /meet/stage/<id>: everyone else in the call is asked to join it, and each
// person sees the board as Freero shares it with them.

/** Google serves the Meet add-ons SDK (the CDN address its guide gives): pages load it from there. */
export const MEET_SDK_ORIGIN = 'https://www.gstatic.com';
export const MEET_SDK_URL = `${MEET_SDK_ORIGIN}/meetjs/addons/1.1.0/meet.addons.js`;
export const MEET_DEPLOYMENT_PATH = '/api/integrations/meet/deployment.json';
export const MEET_LOGO_PATH = '/api/integrations/meet/logo.png';

export function meetDeployment(origin: string) {
  return {
    addOns: {
      common: { name: 'Freero', logoUrl: `${origin}${MEET_LOGO_PATH}` },
      meet: {
        web: {
          sidePanelUrl: `${origin}/meet/sidepanel`,
          supportsScreenSharing: false,
          addOnOrigins: [origin],
          logoUrl: `${origin}${MEET_LOGO_PATH}`,
          darkModeLogoUrl: `${origin}${MEET_LOGO_PATH}`,
        },
      },
    },
  };
}
