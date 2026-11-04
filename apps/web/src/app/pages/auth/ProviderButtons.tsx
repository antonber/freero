import { useEffect, useState } from 'react';
import type { OidcErrorCode, SignInProvider } from '@freero/shared';
import { noteProviderSignIn } from '../../analytics/bridge';
import { api, providerUrl } from '../../api/client';
import { t } from './messages';
import './ProviderButtons.css';

/** The configured providers (none: the buttons don't render at all). Fetched once per page view. */
export function useProviders(): SignInProvider[] {
  const [providers, setProviders] = useState<SignInProvider[]>([]);
  useEffect(() => {
    let live = true;
    api.providers().then(
      (r) => live && setProviders(r.providers),
      () => undefined, // no provider buttons then; email + password still works
    );
    return () => {
      live = false;
    };
  }, []);
  return providers;
}

/** A plain, original mark: the provider's initial in a rounded square (no third-party logos). */
export function ProviderMark({ label }: { label: string }) {
  return (
    <span className="fr-provider-mark" aria-hidden>
      {label.charAt(0)}
    </span>
  );
}

/** "Continue with Google" / "Continue with Microsoft" above the email form, then an "or" rule. */
export function ProviderButtons({ next, verb }: { next: string; verb: string }) {
  const providers = useProviders();
  if (providers.length === 0) return null;
  return (
    <div className="fr-authcard__providers">
      {providers.map((p) => (
        // A full navigation: the provider's page, then back through the callback.
        <a key={p.id} className="fr-authcard__provider" href={providerUrl(p.id, 'login', next !== '/app' ? next : undefined)} onClick={() => noteProviderSignIn(p.id)}>
          <ProviderMark label={p.label} />
          <span>{t('verbWithLabel', { verb, label: p.label })}</span>
        </a>
      ))}
      <div className="fr-authcard__or" role="separator">
        <span>{t('orWithEmail')}</span>
      </div>
    </div>
  );
}

const MESSAGES: Record<OidcErrorCode, string> = {
  cancelled: t('signInWasCancelled'),
  failed: t('thatSignInDidnT'),
  unavailable: t('thatSignInOptionIsn'),
  email_in_use:
    t('anAccountAlreadyUsesThat'),
  no_email: t('theProviderDidnTShare'),
  identity_in_use: t('thatAccountIsAlreadyConnected'),
  provider_linked: t('youAlreadyHaveAnAccount'),
  wrong_account: t('thatSNotTheAccount'),
  signup_closed: t('newAccountsOnThisFreero'),
  sso_required: t('yourOrganizationSignsYouIn'),
  sso_unavailable: t('singleSignOnIsnT'),
  sso_failed: t('yourOrganizationSSignIn'),
  sso_domain: t('yourIdentityProviderSignedYou'),
  sso_removed: t('yourOrganizationHasRemovedYour'),
  sso_unsolicited:
    t('thisWorkspaceDoesnTAccept'),
  suspended: t('thisAccountHasBeenSuspended'),
};

export function providerErrorText(code: string | null): string | null {
  if (!code) return null;
  return (MESSAGES as Record<string, string>)[code] ?? MESSAGES.failed;
}
