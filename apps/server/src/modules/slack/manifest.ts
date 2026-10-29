// The Slack app an operator creates for link unfurls (#88): pasted into api.slack.com/apps → "Create
// New App" → "From a manifest" (docs.slack.dev/reference/app-manifest). Its request URL is this
// module's events route and its unfurl domain the instance's host; `npm run admin -- slack:manifest`
// prints it for PUBLIC_URL, deploy/slack-app-manifest.json is the same for an example host.

export const SLACK_EVENTS_PATH = '/api/integrations/slack/events';

export function slackAppManifest(publicUrl: string) {
  const u = new URL(publicUrl);
  return {
    _metadata: { major_version: 1, minor_version: 1 },
    display_information: {
      name: 'Freero',
      description: 'Previews of Freero board links: title and picture for boards anyone with the link can view.',
      background_color: '#5b3ff0',
    },
    features: {
      bot_user: { display_name: 'freero', always_online: false },
      // Bare host (no scheme, no port): links on any port of it unfurl.
      unfurl_domains: [u.hostname],
    },
    oauth_config: { scopes: { bot: ['links:read', 'links:write'] } },
    settings: {
      event_subscriptions: { request_url: `${u.origin}${SLACK_EVENTS_PATH}`, bot_events: ['link_shared'] },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
