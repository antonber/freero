// The board a Zoom meeting opened for everyone (#168): set by a signed-in participant who can open
// it (and only while it allows embedding, the board's own rule for every embed), read by anyone in
// the meeting — which still shows the board only as its sharing allows. Keyed by the sha256 of
// Zoom's meeting UUID (the SDK's getMeetingUUID: known to the meeting's participants), kept a day.
import { createHash } from 'node:crypto';
import { badRequest, HttpError } from '../../platform/http';
import { boardEmbedding, boardSummaryFor } from '../boards/index';
import * as repo from './repo';

export const MEETING_BOARD_MS = 24 * 60 * 60_000;
const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

function meetingKey(meetingUuid: unknown): string {
  if (typeof meetingUuid !== 'string' || meetingUuid.length < 8 || meetingUuid.length > 200) throw badRequest('meetingUuid is Zoom’s meeting UUID (getMeetingUUID)');
  return createHash('sha256').update(`zoom-meeting:${meetingUuid}`).digest('hex');
}

/** `userId` opens `boardId` for the meeting: they must be able to open it, and it must allow embedding. */
export async function setMeetingBoard(meetingUuid: unknown, boardId: unknown, userId: string, now = Date.now()): Promise<void> {
  const key = meetingKey(meetingUuid);
  if (typeof boardId !== 'string' || !BOARD_ID.test(boardId)) throw badRequest('boardId is a board id');
  await boardSummaryFor(boardId, userId); // 403 / 404 for a board they can't open
  if (!(await boardEmbedding(boardId))) throw new HttpError(404, 'This board can’t be shown in Zoom: its owner hasn’t allowed embedding', 'zoom_board_not_embeddable');
  await repo.setMeetingBoard(key, boardId, userId, now, now + MEETING_BOARD_MS);
}

/** The meeting's board, while it still allows embedding; null otherwise (nothing about any other board). */
export async function meetingBoard(meetingUuid: unknown, now = Date.now()): Promise<string | null> {
  const id = await repo.meetingBoard(meetingKey(meetingUuid), now);
  return id && (await boardEmbedding(id)) ? id : null;
}
