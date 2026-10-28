-- Owned by modules/notifications. Only modules/notifications/repo.ts writes this table.
-- Task cards assigned to someone with a due date (KAI-135), kept from the card events realtime
-- reports (who assigned what, from a trusted socket or request): the due-date reminder job reads
-- it instead of opening every board. Before reminding, the job re-reads the card on the board as
-- the assignee sees it, so a stale row never notifies. `reminded_for`: the due date a reminder was
-- sent for (one reminder per due date).
CREATE TABLE card_due_watch (
  board_id     text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  element_id   text NOT NULL,
  assignee_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  due_date     date NOT NULL,
  title        text NOT NULL,
  reminded_for date,
  PRIMARY KEY (board_id, element_id)
);
CREATE INDEX card_due_watch_due ON card_due_watch (due_date);          -- reminder job
CREATE INDEX card_due_watch_assignee ON card_due_watch (assignee_id);  -- FK cascade
