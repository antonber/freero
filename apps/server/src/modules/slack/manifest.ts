// The Slack app an operator creates for Freero (#88, #105): pasted into api.slack.com/apps →
// "Create New App" → "From a manifest" (docs.slack.dev/reference/app-manifest). Its event request
// URL, slash command URL and OAuth redirect URL are this module's routes on the instance's host,
// and its unfurl domain that host; `npm run admin -- slack:manifest` prints it for PUBLIC_URL,
// deploy/slack-app-manifest.json is the same for an example host. Link previews need only the two
// link scopes and SLACK_SIGNING_SECRET + SLACK_BOT_TOKEN; the rest is "Connect Slack", which stays
// off until SLACK_CLIENT_ID + SLACK_CLIENT_SECRET are set too.

export const SLACK_EVENTS_PATH = '/api/integrations/slack/events';
export const SLACK_COMMANDS_PATH = '/api/integrations/slack/commands';
export const SLACK_OAUTH_CALLBACK_PATH = '/api/integrations/slack/oauth/callback';

/**
 * The bot scopes, each for one thing: link previews (links:read, links:write), direct messages to
 * people who connected (chat:write, im:write), /freero (commands), and their name in Slack shown in
 * their settings (users:read). No user token is asked for.
 */
export const SLACK_BOT_SCOPES = ['links:read', 'links:write', 'chat:write', 'im:write', 'commands', 'users:read'];

export function slackAppManifest(publicUrl: string) {
  const u = new URL(publicUrl);
  return {
    _metadata: { major_version: 1, minor_version: 1 },
    display_information: {
      name: 'Freero',
      description: 'Freero board link previews, your Freero notifications as direct messages, and /freero to create or find a board.',
      background_color: '#5b3ff0',
    },
    features: {
      // Direct messages from the app show in its Messages tab; people can't write back there.
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: true },
      bot_user: { display_name: 'freero', always_online: false },
      slash_commands: [
        {
          command: '/freero',
          url: `${u.origin}${SLACK_COMMANDS_PATH}`,
          description: 'Create a Freero board, or find one',
          usage_hint: 'new <title> · <words to search>',
          should_escape: false,
        },
      ],
      // Bare host (no scheme, no port): links on any port of it unfurl.
      unfurl_domains: [u.hostname],
    },
    oauth_config: {
      redirect_urls: [`${u.origin}${SLACK_OAUTH_CALLBACK_PATH}`],
      scopes: { bot: SLACK_BOT_SCOPES },
    },
    settings: {
      event_subscriptions: { request_url: `${u.origin}${SLACK_EVENTS_PATH}`, bot_events: ['app_uninstalled', 'link_shared', 'tokens_revoked'] },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
