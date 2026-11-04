-- #13: a sign-in that asked for the second step remembers the opaque tag its directory sign-in
-- gave it (SAML: which IdP session it was), handed to onSessionStarted listeners when the session
-- finally opens. Auth never reads it.
ALTER TABLE auth_challenges ADD COLUMN session_tag text;
