-- Owned by modules/auth.
--
-- Single sign-on (modules/sso) caps a session at the identity provider's own session lifetime
-- (SAML SessionNotOnOrAfter, or the workspace's SSO session length). A sign-in that waits for its
-- second step keeps that cap until the session is created.
ALTER TABLE auth_challenges ADD COLUMN session_expires_at timestamptz;

-- Finding the accounts at a domain (enforcing single sign-on ends their other sessions).
CREATE INDEX users_email_domain ON users ((split_part(email, '@', 2)));
