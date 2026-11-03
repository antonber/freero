-- #48: an endpoint may be limited to one project of its workspace (`project_id`): then only events
-- of boards in that project are delivered (it must be a project the whole team can open). NULL: no
-- project filter. No foreign key: a project that is gone simply has no more boards, and the
-- endpoint must not silently widen to every board.
ALTER TABLE webhook_endpoints ADD COLUMN project_id text;
