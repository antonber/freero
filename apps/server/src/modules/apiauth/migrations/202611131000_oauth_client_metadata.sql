-- OAuth clients identified by a client metadata document (#81, draft-ietf-oauth-client-id-metadata-document):
-- the client_id IS the https URL of the document, and the row is Freero's cached copy of what it
-- said (name, client_uri, redirect_uris). `metadata_expires_at`: when the copy must be fetched
-- again before the next authorization request; NULL for every other client (registered in
-- settings, or by dynamic client registration).
ALTER TABLE oauth_clients ADD COLUMN metadata_expires_at timestamptz;
