-- Refresh-token rotation keeps its chain: a refresh token issued in place of another names it.
-- The same app presenting the old one again shortly after (parallel calls, a lost response) gets a
-- fresh pair while it hasn't used a successor yet; once it has, the old one is a replay. Existing
-- tokens have no predecessor recorded, which only matters within a minute of a rotation.
ALTER TABLE api_tokens ADD COLUMN rotated_from text REFERENCES api_tokens(id) ON DELETE SET NULL;
CREATE INDEX api_tokens_rotated_from ON api_tokens (rotated_from) WHERE rotated_from IS NOT NULL;
