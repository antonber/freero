-- Owned by modules/ai. Only modules/ai/repo.ts writes these tables.
--
-- AI (KAI-101): a team workspace's AI settings (its admins turn AI on, pick Freero's provider or
-- their own, and set a budget) and the metered usage per workspace, person and month. Never any
-- prompt or board content: usage is counts only.

CREATE TABLE ai_workspace_settings (
  workspace_id         text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  enabled              boolean NOT NULL DEFAULT false,
  -- 'instance': the operator's provider (AI_PROVIDER); 'workspace': the columns below.
  source               text NOT NULL DEFAULT 'instance' CHECK (source IN ('instance', 'workspace')),
  provider             text NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic', 'openai')),
  base_url             text,
  model                text,
  -- The workspace's key, sealed with platform/secrets (purpose 'ai-workspace-key-v1'); never sent back.
  api_key_sealed       text,
  monthly_token_budget bigint CHECK (monthly_token_budget IS NULL OR monthly_token_budget > 0),
  access               text NOT NULL DEFAULT 'members' CHECK (access IN ('everyone', 'members', 'admins')),
  updated_at           timestamptz NOT NULL,
  updated_by           text
);

-- One row per workspace, person, calendar month (UTC) and provider source, counted up by each call.
CREATE TABLE ai_usage (
  workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month         text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  source        text NOT NULL CHECK (source IN ('instance', 'workspace')),
  requests      integer NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, month, user_id, source)
);
CREATE INDEX ai_usage_user_month ON ai_usage (user_id, month);
