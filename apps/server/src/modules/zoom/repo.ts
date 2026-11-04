// The only writer of `zoom_meeting_boards` [S4]: which board a Zoom meeting opened for everyone.
import { one, query } from '../../platform/db';

/** Sets the meeting's board (the last one opened wins) and drops expired rows. */
export async function setMeetingBoard(meetingKey: string, boardId: string, userId: string, now: number, expiresAt: number): Promise<void> {
  await query(`DELETE FROM zoom_meeting_boards WHERE expires_at <= $1`, [new Date(now)]);
  await query(
    `INSERT INTO zoom_meeting_boards (meeting_key, board_id, set_by, set_at, expires_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (meeting_key) DO UPDATE SET board_id = EXCLUDED.board_id, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at, expires_at = EXCLUDED.expires_at`,
    [meetingKey, boardId, userId, new Date(now), new Date(expiresAt)],
  );
}

/** The meeting's board while its row is live, or null. */
export async function meetingBoard(meetingKey: string, now: number): Promise<string | null> {
  const r = await one<{ board_id: string }>(`SELECT board_id FROM zoom_meeting_boards WHERE meeting_key = $1 AND expires_at > $2`, [meetingKey, new Date(now)]);
  return r?.board_id ?? null;
}
