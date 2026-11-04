// The Power Automate connectors (#88, #175; docs/integrations/power-automate.md), built from the
// Swagger 2.0 that swagger2.mjs makes of docs/api/openapi.json. Pure and deterministic (a test keeps
// the checked-in files in step):
//
// - `withWebhookTrigger(doc, eventTypes)`: Freero's "add a webhook" operation becomes a webhook
//   TRIGGER ("When something happens on a board"): Power Automate posts its callback URL as the
//   webhook's `url` (`x-ms-notification-url`), Freero answers 201 with a `Location` it DELETEs when
//   the flow is turned off, and the events arrive as `x-ms-notification-content` (docs/events.md).
// - `certifiedConnector(doc, opts)`: the files Microsoft certifies (apiDefinition.swagger.json,
//   apiProperties.json): the operations a flow needs, with summaries and descriptions written to
//   Microsoft's rules (learn.microsoft.com/connectors/custom-connectors/certification-submission:
//   summaries of 80 characters or less, letters, digits, spaces and parentheses only; descriptions
//   full sentences; every operation and parameter with a summary, description and visibility; only
//   the responses an operation really gives, with exact schemas), OAuth 2.0 through the generic
//   provider (Freero's own OAuth server; a confidential app, which may leave PKCE out).

import { toSwagger2 } from './swagger2.mjs';

const WEBHOOKS = '/workspaces/{workspaceId}/webhooks';

export const CONNECTOR_FILE = 'docs/integrations/power-automate/freero.swagger.json';
export const CERTIFIED_DIR = 'docs/integrations/power-automate/certified';
/** Stands for the hosted Freero's OAuth app id in the checked-in certification files. */
export const CERTIFIED_CLIENT_ID_PLACEHOLDER = 'FREERO_OAUTH_CLIENT_ID';
/** The hosted Freero the certified connector talks to, and who publishes it (docs/integrations/power-automate.md). */
export const CERTIFIED_HOST = 'freero.app';
export const CERTIFIED_PUBLISHER = 'Kaiten Gaming LLC';

/** The custom connector for an instance at `host`: the whole REST API, with the webhook trigger. */
export function customConnector(openapi, { host, events }) {
  return withWebhookTrigger(toSwagger2(openapi, { host }), events);
}

/** The certification files (name → contents) for the hosted Freero. */
export function certifiedFiles(openapi, { events, clientId, brandColor }) {
  const { apiDefinition, apiProperties } = certifiedConnector(customConnector(openapi, { host: CERTIFIED_HOST, events }), {
    host: CERTIFIED_HOST,
    clientId,
    publisher: CERTIFIED_PUBLISHER,
    brandColor,
    version: openapi.info.version,
  });
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
  return {
    'apiDefinition.swagger.json': json(apiDefinition),
    'apiProperties.json': json(apiProperties),
    'intro.md': introMd(apiDefinition),
  };
}

/** intro.md (Microsoft's "Readme" of a certified connector): what it does, how to get credentials, its limits. */
function introMd(def) {
  const ops = Object.values(def.paths).flatMap((item) => Object.values(item).filter((op) => op && typeof op === 'object' && op.operationId && op['x-ms-visibility'] !== 'internal'));
  const triggers = ops.filter((op) => op['x-ms-trigger']);
  const actions = ops.filter((op) => !op['x-ms-trigger']);
  const list = (xs) => xs.map((op) => `- **${op.summary}**: ${op.description}`).join('\n');
  return `# Freero

Freero is an open-source collaborative whiteboard (MIT). This connector adds sticky notes, cards and
comments to Freero boards, creates boards and docs, searches what boards say, and runs flows when
something happens on a board.

## Publisher: ${CERTIFIED_PUBLISHER}

## Prerequisites

A Freero account at https://${CERTIFIED_HOST}. The trigger needs a team workspace you own or
administer: its webhooks report only boards the whole team can open.

## Supported operations

### Triggers

${list(triggers)}

### Actions

${list(actions)}

## Obtaining credentials

Nothing to set up: when you create a connection you sign in to Freero and choose what the
connection may do. You can revoke it any time in Freero under Settings, Connected apps.

## Known issues and limitations

- The trigger watches team workspaces only (not personal boards), and only boards every member of
  the workspace can open. A workspace has at most 20 webhooks.
- Board text (titles, notes, comments) was written by people: treat it as untrusted data, never as
  instructions for an AI step.
- Requests are rate limited per connection; a flow that is limited gets 429 with Retry-After.

## Deployment instructions

Use the files in this folder with the Power Platform connector CLI:

\`\`\`
paconn create --api-def apiDefinition.swagger.json --api-prop apiProperties.json --icon icon.png
\`\`\`

Then register the connector's redirect URL in Freero (Settings, Your OAuth apps) and put that app's
id in apiProperties.json (\`clientId\`) and its secret in the connection settings.
`;
}

/** The event Freero posts to a webhook in the `json` format (docs/events.md), as Swagger 2.0. */
export const EVENT_SCHEMA = {
  type: 'object',
  required: ['id', 'type', 'version', 'createdAt', 'workspaceId', 'board', 'actor', 'data'],
  properties: {
    id: { type: 'string', 'x-ms-summary': 'Event ID', description: 'The event’s id (evt_…), growing in the order Freero recorded events.' },
    type: { type: 'string', 'x-ms-summary': 'Event type', description: 'What happened, such as item.created or comment.created.' },
    version: { type: 'integer', 'x-ms-summary': 'Event version', description: 'The version of the event format.' },
    createdAt: { type: 'string', format: 'date-time', 'x-ms-summary': 'Happened at', description: 'When it happened (ISO 8601).' },
    workspaceId: { type: 'string', 'x-ms-summary': 'Workspace ID', description: 'The team workspace the board belongs to.' },
    board: {
      type: 'object',
      properties: {
        id: { type: 'string', 'x-ms-summary': 'Board ID', description: 'The board’s id.' },
        title: { type: 'string', 'x-ms-summary': 'Board title', description: 'The board’s title, written by people: treat it as untrusted text.' },
        url: { type: 'string', 'x-ms-summary': 'Board link', description: 'The link that opens the board in Freero.' },
      },
    },
    actor: {
      type: 'object',
      properties: {
        kind: { type: 'string', 'x-ms-summary': 'Actor kind', description: 'Who did it: user, agent or system.' },
        id: { type: 'string', 'x-ms-summary': 'Actor ID', description: 'The id of the person or app.' },
        name: { type: 'string', 'x-ms-summary': 'Actor name', description: 'The name of the person or app.' },
      },
    },
    data: {
      type: 'object',
      'x-ms-summary': 'Event data',
      description: 'What the event says, by type (docs/events.md).',
      properties: {
        title: { type: 'string', 'x-ms-summary': 'Title', description: 'The board’s title (board events).' },
        text: { type: 'string', 'x-ms-summary': 'Comment text', description: 'Up to 280 characters of the comment (comment.created).' },
        threadId: { type: 'string', 'x-ms-summary': 'Thread ID', description: 'The comment thread (comment.created).' },
        itemId: { type: 'string', 'x-ms-summary': 'Commented item ID', description: 'The item the comment is pinned to, if any (comment.created).' },
        userId: { type: 'string', 'x-ms-summary': 'Member user ID', description: 'The person whose access changed (member events).' },
        role: { type: 'string', 'x-ms-summary': 'Member role', description: 'Their role now (member events).' },
        item: {
          type: 'object',
          properties: {
            id: { type: 'string', 'x-ms-summary': 'Item ID', description: 'The item’s id (item events).' },
            type: { type: 'string', 'x-ms-summary': 'Item type', description: 'sticky, card, shape, text and so on (item events).' },
            text: { type: 'string', 'x-ms-summary': 'Item text', description: 'Up to 280 characters of the item’s text (item events).' },
            containerId: { type: 'string', 'x-ms-summary': 'Container ID', description: 'The frame or kanban the item sits in (item events).' },
          },
        },
      },
    },
  },
};

/** The trigger's parameters: Power Automate fills `url`; the person picks the events and, optionally, one board. */
function triggerOperation(base, eventTypes, { summary, description, operationId }) {
  const workspace = base.parameters?.find((p) => p.in === 'path' && p.name === 'workspaceId') ?? { name: 'workspaceId', in: 'path', type: 'string', required: true };
  return {
    tags: base.tags,
    summary,
    description,
    operationId,
    'x-ms-trigger': 'single',
    'x-ms-visibility': 'important',
    parameters: [
      { ...workspace, 'x-ms-summary': 'Workspace ID', description: 'The team workspace whose boards to watch. You must be an owner or admin of it.', 'x-ms-visibility': 'important' },
      {
        in: 'body',
        name: 'body',
        required: true,
        schema: {
          type: 'object',
          required: ['url', 'events'],
          properties: {
            url: { type: 'string', 'x-ms-notification-url': true, 'x-ms-visibility': 'internal', 'x-ms-summary': 'Callback URL', description: 'Where Freero sends the events. Filled in for you.' },
            events: {
              type: 'array',
              'x-ms-summary': 'Events',
              description: 'The events that run the flow.',
              'x-ms-visibility': 'important',
              items: { type: 'string', enum: eventTypes },
            },
            scope: { type: 'string', 'x-ms-summary': 'Only for board', description: 'A board link (or a frame’s copied link) to watch only that board or frame. Leave it empty to watch every board the whole team can open.', 'x-ms-visibility': 'advanced' },
            format: { type: 'string', enum: ['json'], default: 'json', 'x-ms-visibility': 'internal', 'x-ms-summary': 'Format', description: 'The event format. Always json.' },
            description: { type: 'string', default: 'Power Automate flow', 'x-ms-visibility': 'internal', 'x-ms-summary': 'Description', description: 'How the webhook is named in Freero’s admin console.' },
          },
        },
      },
    ],
    responses: base.responses['201'] ? { 201: base.responses['201'] } : base.responses,
  };
}

/**
 * The connector with the webhook trigger in place of "add a webhook": a webhook a flow adds is
 * removed again when the flow is, which the plain action can't do.
 */
export function withWebhookTrigger(doc, eventTypes) {
  const item = doc.paths[WEBHOOKS];
  if (!item?.post) return doc;
  const post = triggerOperation(item.post, eventTypes, {
    operationId: item.post.operationId,
    summary: 'When something happens on a board',
    description: 'Runs the flow when one of the chosen events happens on a board of a team workspace you administer (docs/events.md). The webhook is removed when the flow is.',
  });
  return {
    ...doc,
    paths: { ...doc.paths, [WEBHOOKS]: { ...item, 'x-ms-notification-content': { description: 'A Freero event', schema: { $ref: '#/definitions/FreeroEvent' } }, post } },
    definitions: { ...doc.definitions, FreeroEvent: EVENT_SCHEMA },
  };
}

// ---- the certified connector ----

/** The operations of the certified connector, in Microsoft's words. */
export const CERTIFIED_OPERATIONS = {
  getMe: { summary: 'Get the signed in user', description: 'Gets the Freero account this connection acts for and what it may do.', visibility: 'internal' },
  listWorkspaces: { summary: 'List workspaces', description: 'Lists your Freero workspaces, the personal one first, with your role in each.' },
  listBoards: { summary: 'List boards', description: 'Lists or searches the boards you can open, newest change first.' },
  getBoard: { summary: 'Get a board', description: 'Gets a board, its link and your role on it.' },
  createBoard: { summary: 'Create a board', description: 'Creates a board in one of your workspaces, optionally from a saved template.' },
  getBoardOutline: { summary: 'Get the board outline', description: 'Reads what a board says as its outline: frames, notes, cards, connections and comments.', visibility: 'advanced' },
  listItems: { summary: 'List items', description: 'Lists the items on a board you can see.', visibility: 'advanced' },
  createItems: { summary: 'Add an item', description: 'Adds a sticky note, card, text, shape or other item to a board.' },
  insertStructure: { summary: 'Add cards or notes in free space', description: 'Lays out items, an outline, a table or meeting notes on free space of a board, or puts cards into a kanban column.' },
  listComments: { summary: 'List comments', description: 'Lists the comment threads on a board you can see.', visibility: 'advanced' },
  createComment: { summary: 'Add a comment', description: 'Starts a comment thread on a board, or pinned to one of its items.' },
  replyToComment: { summary: 'Reply to a comment', description: 'Replies in a comment thread on a board.' },
  search: { summary: 'Search boards', description: 'Searches what your boards say and returns the matching items.' },
  listDocs: { summary: 'List docs', description: 'Lists or searches the docs you can open, newest change first.', visibility: 'advanced' },
  getDoc: { summary: 'Get a doc', description: 'Gets a doc and its content as Markdown.' },
  createDoc: { summary: 'Create a doc', description: 'Creates a doc, optionally from Markdown.' },
  appendToDoc: { summary: 'Append to a doc', description: 'Appends Markdown at the end of a doc you own or edit.' },
  createWebhook: { summary: 'When something happens on a board', description: 'Runs the flow when one of the chosen events happens on a board of a team workspace you administer.', trigger: 'OnBoardEvent' },
  deleteWebhook: { summary: 'Remove a webhook', description: 'Removes a webhook. The trigger calls it when a flow is turned off.', visibility: 'internal' },
};

/** Parameter summaries and descriptions by name (path, query and body properties alike). */
const PARAMETER_TEXT = {
  workspaceId: ['Workspace ID', 'The id of the workspace.'],
  webhookId: ['Webhook ID', 'The id of the webhook.'],
  boardId: ['Board ID', 'The id of the board (from its link: the part after /board/).'],
  docId: ['Doc ID', 'The id of the doc (from its link: the part after /doc/).'],
  threadId: ['Thread ID', 'The id of the comment thread.'],
  itemId: ['Item ID', 'The id of the item the comment is pinned to. Leave it empty to comment on the board.'],
  q: ['Search text', 'The words to look for.'],
  workspace: ['Workspace ID', 'Only boards or docs of this workspace.'],
  project: ['Project ID', 'Only boards or docs of this project.'],
  board: ['Board ID', 'Only this board.'],
  limit: ['Limit', 'How many to return at most.'],
  cursor: ['Cursor', 'Where the previous page ended (its nextCursor).'],
  type: ['Item type', 'Only items of this type, such as sticky or card.'],
  format: ['Format', 'The answer’s format.'],
  budget: ['Budget', 'About how many characters the outline may have.'],
  scope: ['Scope', 'Only this frame, kanban or cluster of the board.'],
  authors: ['Authors', 'Whether to say who wrote each item.'],
  include: ['Include', 'More parts of the outline to include.'],
  comments: ['Comments', 'Whether to include comments.'],
  'If-None-Match': ['If none match', 'The ETag of an outline you already have.'],
  title: ['Title', 'The title.'],
  description: ['Description', 'The description.'],
  projectId: ['Project ID', 'The project to put it in.'],
  templateId: ['Template ID', 'A saved template to start from.'],
  text: ['Text', 'The text.'],
  markdown: ['Markdown', 'The content as Markdown.'],
  structure: ['Structure', 'What to lay out: kind items, outline, table, meeting and so on (docs/board-outline.md).'],
  placement: ['Placement', 'Where to put it: into a frame, or a kanban and its column.'],
  near: ['Near item ID', 'Lay it out next to this item.'],
  at: ['Position', 'Lay it out at this point of the board.'],
  target: ['Target', 'The item to change instead of adding new ones.'],
  color: ['Color', 'The item’s color.'],
  x: ['X', 'The horizontal position on the board.'],
  y: ['Y', 'The vertical position on the board.'],
  w: ['Width', 'The width on the board.'],
  h: ['Height', 'The height on the board.'],
  link: ['Link', 'An https link on the card.'],
  containerId: ['Container ID', 'The frame or kanban to put it in.'],
};

const SUMMARY = /^[A-Za-z0-9 ()]{1,80}$/;
const titleCase = (name) =>
  name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID');
const sentence = (s) => {
  const t = String(s ?? '').replace(/`/g, '').trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`;
};
function textFor(name, fallbackDescription) {
  const known = PARAMETER_TEXT[name];
  const summary = known?.[0] ?? titleCase(name);
  return { summary: SUMMARY.test(summary) ? summary : titleCase(name), description: sentence(fallbackDescription) || known?.[1] || `The ${summary.toLowerCase()}.` };
}

/** Summaries, descriptions and visibility on a schema's properties (one level per object, recursively). */
function annotateSchema(s, seen = new Set()) {
  if (!s || typeof s !== 'object' || seen.has(s)) return s;
  seen.add(s);
  const out = { ...s };
  if (out.properties)
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([name, p]) => {
        if (p.$ref) return [name, p];
        const t = textFor(name, p.description);
        return [name, annotateSchema({ ...p, 'x-ms-summary': p['x-ms-summary'] ?? t.summary, description: sentence(p.description) || t.description }, seen)];
      }),
    );
  if (out.items) out.items = annotateSchema(out.items, seen);
  if (out.allOf) out.allOf = out.allOf.map((x) => annotateSchema(x, seen));
  return out;
}

function annotateParameter(p, doc) {
  if (p.$ref) {
    const real = doc.parameters[p.$ref.split('/').pop()];
    return annotateParameter(real, doc);
  }
  if (p.in === 'body') return { ...p, schema: annotateSchema(p.schema), 'x-ms-summary': 'Body', description: sentence(p.description) || 'What to send.' };
  const t = textFor(p.name, p.description);
  return { ...p, 'x-ms-summary': t.summary, description: t.description, 'x-ms-visibility': p.required ? 'important' : 'advanced' };
}

/** Only the answers an operation gives when it works (Microsoft: exact schemas, no error or default responses). */
function successResponses(responses, doc) {
  const out = {};
  for (const [code, r] of Object.entries(responses)) {
    if (!/^2\d\d$/.test(code)) continue;
    const real = r.$ref ? doc.responses[r.$ref.split('/').pop()] : r;
    out[code] = { ...real, description: real.description || 'Done' };
  }
  return out;
}

/** Every definition reachable from `roots` ($ref closure). */
function reachable(doc, roots) {
  const keep = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, x] of Object.entries(v)) {
      if (k === '$ref' && typeof x === 'string' && x.startsWith('#/definitions/')) {
        const name = x.slice('#/definitions/'.length);
        if (!keep.has(name)) {
          keep.add(name);
          walk(doc.definitions[name]);
        }
      } else walk(x);
    }
  };
  walk(roots);
  return keep;
}

/**
 * The certified connector for the hosted Freero at `host`: apiDefinition.swagger.json and
 * apiProperties.json. `doc` is the connector with the webhook trigger (withWebhookTrigger).
 */
export function certifiedConnector(doc, { host, clientId, publisher, brandColor, version }) {
  const paths = {};
  for (const [p, item] of Object.entries(doc.paths)) {
    const out = {};
    for (const [m, op] of Object.entries(item)) {
      if (m === 'parameters' || m.startsWith('x-')) continue;
      const text = CERTIFIED_OPERATIONS[op.operationId];
      if (!text) continue;
      const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((x) => annotateParameter(x, doc));
      const named = new Map();
      for (const x of parameters) named.set(`${x.in}:${x.name}`, x); // an operation's own wins over the path's
      out[m] = {
        tags: op.tags,
        summary: text.summary,
        description: text.description,
        operationId: text.trigger ?? op.operationId,
        'x-ms-visibility': text.visibility ?? (op['x-ms-trigger'] ? 'important' : 'none'),
        ...(op['x-ms-trigger'] ? { 'x-ms-trigger': op['x-ms-trigger'] } : {}),
        ...(op.produces ? { produces: op.produces } : {}),
        parameters: [...named.values()],
        responses: successResponses(op.responses, doc),
      };
    }
    if (Object.keys(out).length) {
      if (item['x-ms-notification-content']) out['x-ms-notification-content'] = item['x-ms-notification-content'];
      paths[p] = out;
    }
  }
  const keep = reachable(doc, paths);
  const definitions = Object.fromEntries(Object.entries(doc.definitions).filter(([k]) => keep.has(k)).map(([k, v]) => [k, annotateSchema(v)]));
  const origin = `https://${host}`;
  const apiDefinition = {
    swagger: '2.0',
    info: {
      title: 'Freero',
      description: 'Freero is an open-source collaborative whiteboard. Add sticky notes, cards and comments to boards, create boards and docs, and run flows when something happens on a board.',
      version,
      contact: { name: publisher, url: `${origin}/support`, email: 'support@freero.app' },
    },
    host,
    basePath: doc.basePath,
    schemes: ['https'],
    consumes: ['application/json'],
    produces: ['application/json'],
    paths,
    definitions,
    parameters: {},
    responses: {},
    securityDefinitions: {
      oauth2_auth: {
        type: 'oauth2',
        flow: 'accessCode',
        authorizationUrl: `${origin}/oauth/authorize`,
        tokenUrl: `${origin}/api/oauth/token`,
        scopes: { 'boards:read': 'Read boards', 'boards:write': 'Change boards', 'comments:write': 'Comment', 'webhooks:manage': 'Manage webhooks' },
      },
    },
    security: [{ oauth2_auth: ['boards:read', 'boards:write', 'comments:write', 'webhooks:manage'] }],
    tags: [],
    'x-ms-connector-metadata': [
      { propertyName: 'Website', propertyValue: `${origin}/` },
      { propertyName: 'Privacy policy', propertyValue: `${origin}/privacy` },
      { propertyName: 'Categories', propertyValue: 'Collaboration;Productivity' },
    ],
  };
  const apiProperties = {
    properties: {
      connectionParameters: {
        token: {
          type: 'oauthSetting',
          oAuthSettings: {
            identityProvider: 'oauth2',
            clientId,
            scopes: ['boards:read', 'boards:write', 'comments:write', 'webhooks:manage'],
            redirectMode: 'GlobalPerConnector',
            redirectUrl: 'https://global.consent.azure-apim.net/redirect',
            properties: { IsFirstParty: 'False' },
            customParameters: {
              authorizationUrl: { value: `${origin}/oauth/authorize` },
              tokenUrl: { value: `${origin}/api/oauth/token` },
              refreshUrl: { value: `${origin}/api/oauth/token` },
            },
          },
        },
      },
      iconBrandColor: brandColor,
      capabilities: [],
      publisher,
      stackOwner: publisher,
      policyTemplateInstances: [],
    },
  };
  return { apiDefinition, apiProperties };
}
