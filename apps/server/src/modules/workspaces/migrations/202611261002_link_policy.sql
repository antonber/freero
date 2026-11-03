-- Owned by modules/workspaces.
-- Link policy (#39): what a team requires of its boards' links before one is turned on or changed —
-- a password ('required'), and/or an expiry at most link_max_days ahead (null: no limit). Links that
-- were on before keep working; the admin console lists the boards that don't comply.
ALTER TABLE workspaces ADD COLUMN link_password text NOT NULL DEFAULT 'optional'
  CHECK (link_password IN ('optional', 'required'));
ALTER TABLE workspaces ADD COLUMN link_max_days integer
  CHECK (link_max_days IS NULL OR (link_max_days BETWEEN 1 AND 365));
