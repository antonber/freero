-- Owned by modules/marketplace. Only modules/marketplace/repo.ts writes this table.
--
-- Community listings of the Apps & agents page (#87): integrations people built on Freero's API or
-- MCP. A submission is 'pending' until an operator decides (modules/moderation records every
-- decision and its audit event, then sets the status here through this module's index):
-- 'approved' (live, labelled Community), 'rejected', or later 'removed'. Only approved listings are
-- shown to anyone but their submitter and operators.
--
-- status_note: what the operator wrote with the last decision, for the submitter.
-- oauth_client_id: one of the submitter's own OAuth apps (modules/apiauth), checked when submitted;
--   no foreign key (another module's table): an app deleted since simply shows no longer.
-- contact_email: for the reviewers only, never shown to others.
CREATE TABLE marketplace_listings (
  id               text PRIMARY KEY,
  submitter_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  featured         boolean NOT NULL DEFAULT false,
  name             text NOT NULL,
  tagline          text NOT NULL,
  description      text NOT NULL DEFAULT '',
  website          text NOT NULL,
  docs_url         text,
  category         text NOT NULL,
  built_on         text[] NOT NULL,
  oauth_client_id  text,
  contact_email    text,
  status_note      text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL,
  decided_at       timestamptz
);
CREATE INDEX marketplace_listings_status ON marketplace_listings (status, created_at);
CREATE INDEX marketplace_listings_submitter ON marketplace_listings (submitter_id);
