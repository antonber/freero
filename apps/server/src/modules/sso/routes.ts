import express, { Router, type Request } from 'express';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { allowCrossSitePost } from '../../platform/security';
import { currentUser, requireUser, safeReturnPath } from '../auth/index';
import { requireWorkspaceRole } from '../workspaces/index';
import { removeConnection, saveConnection, serviceProviderUrls, setEnforcement, ssoSettings } from './connections';
import { cancelCapture, domainControlSettings, setDomainControl, startCaptures } from './domainControl';
import { addDomain, removeDomain, verifyDomain } from './domains';
import { samlSlo } from './logout';
import { discover } from './policy';
import * as repo from './repo';
import { serviceProviderMetadata } from './saml';
import { oidcCallback, samlAcs, samlFinish, startSso } from './signIn';
import { createSpKey, promoteSpKey, removeSpKey } from './spKeys';

// The identity provider's page posts the signed response here from its own origin. The response is
// the credential (signature, audience, InResponseTo, replay are checked) and the sign-in completes
// only on a same-site GET from the browser that started it, so the cross-site POST can't ride
// anyone's cookies.
allowCrossSitePost(/^\/api\/sso\/[^/]+\/saml\/acs$/, 'SAML HTTP-POST binding: the IdP page posts the signed response cross-site');
// Single logout (#13) over HTTP-POST: the IdP's page posts its signed LogoutRequest (or its
// LogoutResponse to ours) cross-site. Only a message whose signature, issuer, Destination, age
// and one-time ID check out ends anything, and only the SAML sessions of the NameID it names.
allowCrossSitePost(/^\/api\/sso\/[^/]+\/saml\/slo$/, 'SAML single logout, HTTP-POST binding: the IdP page posts the signed logout message cross-site');

/** Owners/admins of a TEAM workspace, or of an organisation (#108: for all its workspaces), manage its single sign-on. */
async function manager(req: Request) {
  const ws = await requireWorkspaceRole(req.params.id, currentUser(req).id, 'admin', { organisation: true, scope: 'security' });
  if (ws.kind === 'personal') throw badRequest('Single sign-on is set up for a team workspace');
  return ws;
}

export default function ssoRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // ---- admin ----
  r.get('/workspaces/:id/sso', requireUser, handle(async (req, res) => {
    await manager(req);
    res.json(await ssoSettings(req, req.params.id));
  }));
  r.post('/workspaces/:id/sso/domains', requireUser, handle(async (req, res) => {
    await manager(req);
    await addDomain(req.params.id, currentUser(req).id, req.body?.domain);
    res.status(201).json(await ssoSettings(req, req.params.id));
  }));
  r.post('/workspaces/:id/sso/domains/:domainId/verify', requireUser, rateLimit('sso', 'user'), handle(async (req, res) => {
    await manager(req);
    await verifyDomain(req.params.id, req.params.domainId, currentUser(req).id);
    res.json(await ssoSettings(req, req.params.id));
  }));
  r.delete('/workspaces/:id/sso/domains/:domainId', requireUser, handle(async (req, res) => {
    await manager(req);
    await removeDomain(req.params.id, currentUser(req).id, req.params.domainId);
    res.json(await ssoSettings(req, req.params.id));
  }));
  r.put('/workspaces/:id/sso/connection', requireUser, handle(async (req, res) => {
    await manager(req);
    await saveConnection(req.params.id, currentUser(req).id, req.body ?? {});
    res.json(await ssoSettings(req, req.params.id));
  }));
  r.delete('/workspaces/:id/sso/connection', requireUser, handle(async (req, res) => {
    const ws = await manager(req);
    if (ws.role !== 'owner') throw badRequest('Only a workspace owner can remove single sign-on');
    await removeConnection(req.params.id, currentUser(req).id);
    res.json(await ssoSettings(req, req.params.id));
  }));
  r.post('/workspaces/:id/sso/enforce', requireUser, handle(async (req, res) => {
    const ws = await manager(req);
    const sessionsEnded = await setEnforcement(req.params.id, { id: currentUser(req).id, role: ws.role }, req.body ?? {});
    res.json({ ...(await ssoSettings(req, req.params.id)), sessionsEnded });
  }));

  // ---- the SAML service provider's key pairs (#13): certificates are public, private keys never leave ----
  r.post('/workspaces/:id/sso/sp-keys', requireUser, rateLimit('sso', 'user'), handle(async (req, res) => {
    await manager(req);
    await createSpKey(req.params.id, currentUser(req).id);
    res.status(201).json(await ssoSettings(req, req.params.id));
  }));
  r.post('/workspaces/:id/sso/sp-keys/:keyId/promote', requireUser, handle(async (req, res) => {
    await manager(req);
    await promoteSpKey(req.params.id, req.params.keyId, currentUser(req).id);
    res.json(await ssoSettings(req, req.params.id));
  }));
  r.delete('/workspaces/:id/sso/sp-keys/:keyId', requireUser, handle(async (req, res) => {
    await manager(req);
    await removeSpKey(req.params.id, req.params.keyId, currentUser(req).id);
    res.json(await ssoSettings(req, req.params.id));
  }));

  // ---- domain control (#64): verified domains, with or without SSO ----
  r.get('/workspaces/:id/sso/domain-control', requireUser, handle(async (req, res) => {
    await manager(req);
    res.json(await domainControlSettings(req.params.id));
  }));
  r.put('/workspaces/:id/sso/domain-control', requireUser, handle(async (req, res) => {
    await manager(req);
    await setDomainControl(req.params.id, currentUser(req).id, req.body ?? {});
    res.json(await domainControlSettings(req.params.id));
  }));
  r.post('/workspaces/:id/sso/domain-control/captures', requireUser, rateLimit('sso', 'user'), handle(async (req, res) => {
    await manager(req);
    const started = await startCaptures(req.params.id, currentUser(req).id, req.body ?? {});
    res.json({ ...(await domainControlSettings(req.params.id)), started });
  }));
  r.delete('/workspaces/:id/sso/domain-control/captures/:userId', requireUser, handle(async (req, res) => {
    await manager(req);
    await cancelCapture(req.params.id, currentUser(req).id, req.params.userId);
    res.json(await domainControlSettings(req.params.id));
  }));

  // ---- public: routing and the browser flows ----
  r.get('/sso/discover', rateLimit('sso'), handle(async (req, res) => {
    res.json(await discover(req, req.query.email, safeReturnPath(req.query.next, '/app')));
  }));
  r.get('/sso/:workspaceId/start', rateLimit('sso'), handle(startSso));
  r.post('/sso/:workspaceId/saml/acs', rateLimit('sso'), express.urlencoded({ extended: false, limit: '1mb' }), handle(samlAcs));
  r.get('/sso/:workspaceId/saml/finish', rateLimit('sso'), handle(samlFinish));
  r.get('/sso/:workspaceId/oidc/callback', rateLimit('sso'), handle(oidcCallback));
  r.get('/sso/:workspaceId/saml/slo', rateLimit('sso'), handle(samlSlo));
  r.post('/sso/:workspaceId/saml/slo', rateLimit('sso'), express.urlencoded({ extended: false, limit: '1mb' }), handle(samlSlo));
  r.get('/sso/:workspaceId/saml/metadata', handle(async (req, res) => {
    const sp = serviceProviderUrls(req, req.params.workspaceId);
    const [keys, c] = await Promise.all([repo.listSpKeys(req.params.workspaceId), repo.getConnection(req.params.workspaceId)]);
    res.type('application/samlmetadata+xml').send(
      serviceProviderMetadata({
        entityId: sp.entityId,
        acsUrl: sp.acsUrl,
        sloUrl: sp.sloUrl,
        certificates: keys.map((k) => k.certificate),
        signsRequests: !!c?.signRequests && keys.some((k) => k.current),
      }),
    );
  }));

  return r;
}
