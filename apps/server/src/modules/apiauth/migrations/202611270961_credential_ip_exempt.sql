-- Owned by modules/apiauth. #156: a workspace's security admins exempt one token or app from its IP
-- allowlist (an integration that runs on a server outside the company's networks).
ALTER TABLE api_workspace_credentials ADD COLUMN ip_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE api_workspace_credentials ADD COLUMN ip_exempt_by text;
