// The Microsoft Teams app package of THIS instance (#112, #113; docs/integrations/teams.md): a zip of
// manifest.json + color.png + outline.png that an organisation's Teams admin uploads (Teams admin
// center → Manage apps → Upload, or the org's app catalog), or the operator submits to the Teams
// store through Partner Center. Built from the instance's address and the operator's ids, so every
// self-hosted Freero offers its own; nothing in it is secret.
//
// - A configurable tab (channels, group chats, meetings: chat tab, details, side panel, stage) whose
//   configuration page /teams/config picks a board and whose content is /teams/b/<id> — the board
//   embedded live (modules/embed's public embed: its sharing, its sign-in popup), framed by Teams only.
// - With the Azure Bot (TEAMS_BOT_ID): a message extension that previews Freero links pasted in a
//   message (link unfurling, bot.ts), also for people who haven't added the app (anonymised payloads).
// - `MeetingStage.Write.Chat` / `ChannelMeetingStage.Write.Group` (resource-specific consent): the
//   side panel's "Share to stage" button (meeting.shareAppContentToStage).
import { zipSync } from 'fflate';
import type { Config } from '../../platform/config';
import { colorIcon, outlineIcon } from './icons';

export const TEAMS_MANIFEST_VERSION = '1.19';
export const TEAMS_MANIFEST_SCHEMA = `https://developer.microsoft.com/json-schemas/teams/v${TEAMS_MANIFEST_VERSION}/MicrosoftTeams.schema.json`;
/**
 * The package's version unless the operator gives one: Teams accepts an uploaded update only with a
 * higher version, so each new package for the same app id needs `--version` / `?version=` (semver).
 */
export const TEAMS_APP_VERSION = '1.0.0';
export const SEMVER = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
export const BRAND_ACCENT = '#5B3FF0';

/** Where the bot's messaging endpoint answers (set it as the Azure Bot's messaging endpoint). */
export const TEAMS_MESSAGES_PATH = '/api/integrations/teams/messages';
export const TEAMS_CONFIG_PATH = '/teams/config';
export const TEAMS_PACKAGE_PATH = '/api/integrations/teams/app-package';

/** The instance's https origin a package can point at, or an error saying what to set. */
export function packageOrigin(publicUrl: string | null): string {
  if (!publicUrl) throw new Error('Set PUBLIC_URL to the https address people open Freero at: the app package points Teams there');
  const u = new URL(publicUrl);
  if (u.protocol !== 'https:') throw new Error('Microsoft Teams loads apps over https only: PUBLIC_URL must be an https address');
  return u.origin;
}

/** The developer block every Microsoft 365 app manifest carries: the instance's own pages. */
export function developerInfo(origin: string) {
  return { name: 'Freero', websiteUrl: `${origin}/`, privacyUrl: `${origin}/privacy`, termsOfUseUrl: `${origin}/terms` };
}

export function teamsAppManifest(origin: string, teams: NonNullable<Config['teams']>, version = TEAMS_APP_VERSION) {
  const { hostname, host } = new URL(origin);
  const bot = teams.bot;
  return {
    $schema: TEAMS_MANIFEST_SCHEMA,
    manifestVersion: TEAMS_MANIFEST_VERSION,
    version,
    id: teams.appId,
    developer: developerInfo(origin),
    name: { short: 'Freero', full: 'Freero whiteboard' },
    description: {
      short: 'Your Freero boards in channels, chats and meetings, live.',
      full: [
        'Add a Freero board to a channel, a chat or a meeting. It opens live in the tab and the meeting side panel, and presenters can share it to the meeting stage so everyone works on the same board.',
        'What each person sees follows the board’s sharing in Freero: people the board is shared with sign in once and can edit or comment as they can in Freero; boards anyone with the link may view show read-only to everyone else.',
        bot ? 'Freero board links pasted in a message unfold into a preview: title, description and picture for boards anyone with the link can view, and a card that names nothing for every other board.' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: BRAND_ACCENT,
    configurableTabs: [
      {
        configurationUrl: `${origin}${TEAMS_CONFIG_PATH}`,
        canUpdateConfiguration: true,
        scopes: ['team', 'groupChat'],
        context: ['channelTab', 'privateChatTab', 'meetingChatTab', 'meetingDetailsTab', 'meetingSidePanel', 'meetingStage'],
        meetingSurfaces: ['sidePanel', 'stage'],
      },
    ],
    ...(bot
      ? {
          composeExtensions: [
            {
              botId: bot.id,
              composeExtensionType: 'botBased',
              commands: [],
              messageHandlers: [{ type: 'link', value: { domains: [hostname], supportsAnonymizedPayloads: true } }],
            },
          ],
        }
      : {}),
    permissions: ['identity'],
    validDomains: [host],
    authorization: {
      permissions: {
        resourceSpecific: [
          { name: 'MeetingStage.Write.Chat', type: 'Delegated' },
          { name: 'ChannelMeetingStage.Write.Group', type: 'Delegated' },
        ],
      },
    },
  };
}

/** The package: manifest.json and the two icons at the zip's root, as Teams expects. */
export function teamsAppPackage(origin: string, teams: NonNullable<Config['teams']>, version = TEAMS_APP_VERSION): Uint8Array {
  return zipSync({
    'manifest.json': Buffer.from(JSON.stringify(teamsAppManifest(origin, teams, version), null, 2)),
    'color.png': colorIcon(),
    'outline.png': outlineIcon(),
  });
}
