// /oauth/authorize — the consent screen of Freero's OAuth server (KAI-104; the MCP server reuses it).
// An app sends the person here; they see which app, what it may do and where it sends them back,
// then allow or deny. Signed out: RequireAuth sends them to log in and back here. The server checks
// everything again on the decision; an unknown app or redirect is shown here, never redirected to.
// Some powers are opt-in (`optional`: the MCP server's direct board writes — read + suggest is the
// default there): they are off until the person ticks them, and only the ticked ones are granted.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Plug, ShieldAlert } from 'lucide-react';
import type { ApiScope, OAuthConsentInfo } from '@freero/shared';
import { Button, Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from '../auth/AuthShell';
import './oauth.css';

export function OAuthConsentPage() {
  const { search } = useLocation();
  const { user } = useAuth();
  const query = search.replace(/^\?/, '');
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(query)), [query]);
  const [consent, setConsent] = useState<OAuthConsentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [grant, setGrant] = useState<ApiScope[]>([]);

  useEffect(() => {
    let live = true;
    api.oauthConsent(query).then(
      (out) => {
        if (!live) return;
        if ('redirect' in out) window.location.replace(out.redirect);
        else setConsent(out.consent);
      },
      (err) => live && setError(err instanceof ApiError ? err.message : 'Could not reach Freero. Try again.'),
    );
    return () => {
      live = false;
    };
  }, [query]);

  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(decision);
    try {
      window.location.assign((await api.oauthDecide(params, decision, grant)).redirect);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(null);
    }
  };

  if (error)
    return (
      <AuthShell docTitle="Connect an app" title="This app can’t connect">
        <AuthNotice kind="error">{error}</AuthNotice>
      </AuthShell>
    );
  if (!consent)
    return (
      <AuthShell docTitle="Connect an app" title="Checking the app…">
        <Spinner size={22} label="Checking the app" />
      </AuthShell>
    );

  const { client } = consent;
  const always = consent.scopes.filter((s) => !s.optional);
  const optional = consent.scopes.filter((s) => s.optional);
  const nothing = always.length === 0 && grant.length === 0;
  return (
    <AuthShell docTitle={`Connect ${client.name}`} title={`${client.name} wants to use your Freero account`} sub={user ? `Signed in as ${user.name} (${user.email})` : undefined}>
      <div className="fr-oauth">
        <div className="fr-oauth__app">
          <span className="fr-oauth__app-icon" aria-hidden>
            <Plug size={20} />
          </span>
          <span className="fr-oauth__app-name">
            <strong>{client.name}</strong>
            {client.website ? <span>{client.website}</span> : null}
          </span>
        </div>
        {client.registration === 'dynamic' ? (
          <p className="fr-oauth__warn">
            <ShieldAlert size={16} aria-hidden />
            <span>This app registered itself and hasn’t been reviewed by Freero. Only allow apps you trust.</span>
          </p>
        ) : null}
        <p className="fr-oauth__lead">It will be able to use the {consent.resource} to:</p>
        <ul className="fr-oauth__scopes">
          {always.map((s) => (
            <li key={s.id}>
              <Check size={15} aria-hidden />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        {optional.length ? (
          <fieldset className="fr-oauth__optional">
            <legend>It also asks to — off unless you turn it on:</legend>
            {optional.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={grant.includes(s.id)}
                  onChange={(e) => setGrant((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className="fr-oauth__fine">
          It acts as you and never gets more access than you have. Text on boards is passed to it as content, not as instructions. You can revoke it any time in
          Settings → Connected apps.
        </p>
        <p className="fr-oauth__fine">
          Afterwards you’ll go to <strong className="fr-oauth__origin">{consent.redirectOrigin}</strong>.
        </p>
        <div className="fr-oauth__actions">
          <Button size="lg" onClick={() => decide('deny')} loading={busy === 'deny'} disabled={busy !== null}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" onClick={() => decide('allow')} loading={busy === 'allow'} disabled={busy !== null || nothing}>
            Allow
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
