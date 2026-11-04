-- Owned by modules/keys. Only modules/keys/repo.ts writes these tables.
--
-- #159 (docs/design/compliance.md §3): a team workspace's encryption key. Board content of the
-- workspace is sealed with a data key (DEK, AES-256-GCM) that is stored only WRAPPED by the
-- workspace's key-encryption key (KEK): the instance's ('instance', derived from SESSION_SECRET)
-- or the workspace's own AWS KMS key ('aws-kms', its ARN in kms_key_id). Data keys are versioned:
-- new content is sealed with current_version, older content keeps naming the version it was
-- sealed with. Destroying the key deletes every wrapped data key (crypto-shredding).
CREATE TABLE workspace_keys (
  workspace_id     text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('instance', 'aws-kms')),
  kms_key_id       text,
  state            text NOT NULL CHECK (state IN ('active', 'suspended', 'unavailable', 'destroyed')),
  -- Why it is unavailable (the KMS's answer); never key material.
  state_reason     text,
  current_version  integer NOT NULL DEFAULT 1,
  created_by       text REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL,
  state_changed_at timestamptz NOT NULL,
  kek_rotated_at   timestamptz,
  CHECK ((provider = 'aws-kms') = (kms_key_id IS NOT NULL))
);

CREATE TABLE workspace_data_keys (
  workspace_id text NOT NULL REFERENCES workspace_keys (workspace_id) ON DELETE CASCADE,
  version      integer NOT NULL,
  -- The DEK wrapped by the KEK named in kek_ref ('instance' or the KMS key ARN).
  wrapped      text NOT NULL,
  kek_ref      text NOT NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, version)
);
