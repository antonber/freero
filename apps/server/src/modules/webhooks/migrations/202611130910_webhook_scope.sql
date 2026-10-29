-- KAI-249: an endpoint may be scoped to one board (`board_id`), and on it to one item (`item_id`: a
-- frame or a kanban, e.g. an agent's control-room lane) — then only events about that board, or
-- about that item and what sits directly in it, are delivered. NULL: every board the whole team can
-- open, as before. No foreign key: a board that is gone simply has no more events, and the endpoint
-- must not silently widen to every board.
ALTER TABLE webhook_endpoints ADD COLUMN board_id text;
ALTER TABLE webhook_endpoints ADD COLUMN item_id text;
