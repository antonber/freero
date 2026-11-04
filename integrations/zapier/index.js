// Freero's Zapier app (#173; docs/integrations/zapier.md), for the Zapier Platform CLI
// (`zapier push` from this folder). MIT, like the rest of Freero; the Zapier Platform packages it
// runs on are Zapier's own (see package.json).
//
// Triggers: Board Event (instant, through a workspace webhook the Zap adds and removes), New Item,
// New Comment (polling). Actions: Add Sticky Note, Add Card, Add Comment, Create Board. Search:
// Find Board. Every call is Freero's REST API v1 with the person's OAuth token, so it does what they
// may do and is in Freero's audit log under the app's name.
'use strict';

const { version } = require('./package.json');
const authentication = require('./authentication');
const lists = require('./triggers/lists');
const polling = require('./triggers/polling');
const boardEvent = require('./triggers/board_event');
const creates = require('./creates');
const searches = require('./searches');

/** Every request carries the connection's token and asks for JSON. */
const addAuth = (request, z, bundle) => {
  request.headers = request.headers || {};
  if (bundle.authData && bundle.authData.access_token && !request.url.endsWith('/api/oauth/token')) request.headers.Authorization = `Bearer ${bundle.authData.access_token}`;
  if (!request.headers.accept) request.headers.accept = 'application/json';
  return request;
};

/** An expired token asks Zapier to refresh; Freero's own error message is shown otherwise. */
const explainErrors = (response, z) => {
  if (response.status === 401 && !String(response.request && response.request.url).endsWith('/api/oauth/token')) throw new z.errors.RefreshAuthError('Freero asked to sign in again.');
  if (response.status >= 400) {
    let message = `Freero answered ${response.status}`;
    try {
      const body = typeof response.content === 'string' ? JSON.parse(response.content) : response.data;
      if (body && (body.error_description || body.error)) message = `${message}: ${body.error_description || body.error}`;
    } catch (e) {
      /* not JSON */
    }
    throw new z.errors.Error(message, response.status === 429 ? 'Throttled' : 'FreeroError', response.status);
  }
  return response;
};

module.exports = {
  version,
  platformVersion: require('./package.json').dependencies['zapier-platform-core'],
  authentication,
  beforeRequest: [addAuth],
  afterResponse: [explainErrors],
  triggers: {
    [boardEvent.key]: boardEvent,
    [polling.new_item.key]: polling.new_item,
    [polling.new_comment.key]: polling.new_comment,
    [lists.workspaces.key]: lists.workspaces,
    [lists.admin_workspaces.key]: lists.admin_workspaces,
    [lists.boards.key]: lists.boards,
  },
  creates: Object.fromEntries(Object.values(creates).map((c) => [c.key, c])),
  searches: Object.fromEntries(Object.values(searches).map((s) => [s.key, s])),
};
