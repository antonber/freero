-- Owned by modules/boards. #157: legal holds. Only boards deletes boards, so the hold is kept here,
-- keyed by an opaque hold id (an eDiscovery case's id, modules/ediscovery):
--   board_legal_holds        a board held by a hold (picked explicitly, or carried along when it left
--                            a held owner: via_owner names that owner);
--   board_owner_legal_holds  every board a person (a custodian) owns in a workspace, now and later.
-- The database refuses to delete a held board on ANY path (a statement of this module, the cascade
-- of a deleted account or workspace, raw SQL): the foreign keys RESTRICT and a trigger checks the
-- owner holds. When a board leaves a held owner (transfer, hand-over, move to another workspace) the
-- trigger gives it its own row first, so a custodian's board stays held wherever it goes.
-- discarded_at: its owner deleted it forever while it was held — hidden from everyone, kept for the
-- case, purged once no hold is left.
CREATE TABLE board_legal_holds (
  hold_id    text NOT NULL,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE RESTRICT,
  via_owner  text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (hold_id, board_id)
);
CREATE INDEX board_legal_holds_board ON board_legal_holds (board_id);

CREATE TABLE board_owner_legal_holds (
  hold_id      text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  owner_id     text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (hold_id, workspace_id, owner_id)
);
CREATE INDEX board_owner_legal_holds_owner ON board_owner_legal_holds (owner_id, workspace_id);
CREATE INDEX board_owner_legal_holds_workspace ON board_owner_legal_holds (workspace_id);

ALTER TABLE boards ADD COLUMN discarded_at timestamptz;
CREATE INDEX boards_discarded ON boards (discarded_at) WHERE discarded_at IS NOT NULL;

CREATE FUNCTION boards_legal_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM board_legal_holds h WHERE h.board_id = OLD.id)
       OR EXISTS (SELECT 1 FROM board_owner_legal_holds h WHERE h.owner_id = OLD.owner_id AND h.workspace_id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'board % is under a legal hold', OLD.id USING ERRCODE = 'FH001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    INSERT INTO board_legal_holds (hold_id, board_id, via_owner, created_at)
      SELECT h.hold_id, OLD.id, OLD.owner_id, now() FROM board_owner_legal_holds h
      WHERE h.owner_id = OLD.owner_id AND h.workspace_id = OLD.workspace_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER boards_legal_hold_on_delete BEFORE DELETE ON boards
  FOR EACH ROW EXECUTE FUNCTION boards_legal_hold_guard();
CREATE TRIGGER boards_legal_hold_on_move BEFORE UPDATE OF owner_id, workspace_id ON boards
  FOR EACH ROW EXECUTE FUNCTION boards_legal_hold_guard();
