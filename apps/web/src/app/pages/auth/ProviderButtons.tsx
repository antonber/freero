import { useEffect, useState } from 'react';
import type { OidcErrorCode, SignInProvider } from '@freero/shared';
import { api, providerUrl } from '../../api/client';
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
        <a key={p.id} className="fr-authcard__provider" href={providerUrl(p.id, 'login', next !== '/app' ? next : undefined)}>
          <ProviderMark label={p.label} />
          <span>
            {verb} with {p.label}
          </span>
        </a>
      ))}
      <div className="fr-authcard__or" role="separator">
        <span>or with email</span>
      </div>
    </div>
  );
}

const MESSAGES: Record<OidcErrorCode, string> = {
  cancelled: 'Sign-in was cancelled.',
  failed: 'That sign-in didn’t go through. Please try again.',
  unavailable: 'That sign-in option isn’t available right now. Try again later, or use your email.',
  email_in_use:
    'An account already uses that email address, but the provider didn’t confirm it belongs to you. Log in with your password, then connect the provider in Account settings.',
  no_email: 'The provider didn’t share an email address with Freero, so we can’t sign you in with it.',
  identity_in_use: 'That account is already connected to another Freero account.',
  provider_linked: 'You already have an account of that provider connected. Disconnect it first to connect another one.',
  wrong_account: 'That’s not the account connected to Freero. Sign in with the one you connected.',
  sso_required: 'Your organization signs you in with single sign-on. Continue with SSO below.',
  sso_unavailable: 'Single sign-on isn’t available for this workspace right now. Ask your workspace admin.',
  sso_failed: 'Your organization’s sign-in didn’t go through, or it expired. Please try again.',
  sso_domain: 'Your identity provider signed you in with an address this workspace hasn’t verified. Ask your workspace admin.',
  sso_removed: 'Your organization has removed your access to this workspace. Ask your workspace admin.',
  suspended: 'This account has been suspended. We emailed you the reason and how to appeal.',
};

export function providerErrorText(code: string | null): string | null {
  if (!code) return null;
  return (MESSAGES as Record<string, string>)[code] ?? MESSAGES.failed;
}
