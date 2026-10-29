-- Owned by modules/workspaces.
-- Live embeds (KAI-127): whether links to allow-listed providers (videos, design files, docs) may
-- be activated as live frames on the workspace's boards; 'off' keeps every link a preview card.
ALTER TABLE workspaces ADD COLUMN live_embeds text NOT NULL DEFAULT 'on'
  CHECK (live_embeds IN ('on', 'off'));
