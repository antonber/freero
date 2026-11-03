-- #107: sign-ins started at the identity provider (its app tile: an unsolicited SAML response, no
-- InResponseTo). Off by default; with it on the ACS accepts them under the same checks as answers to
-- our own requests (signature, audience, Recipient, Destination, timestamps, assertion-ID replay
-- cache in sso_saml_cache until the assertion's NotOnOrAfter).
ALTER TABLE sso_connections ADD COLUMN idp_initiated boolean NOT NULL DEFAULT false;
