// Timeline geometry and layout: one implementation, in @freero/shared (layout/timeline.ts), which
// the server also runs when a tracker changes a bar's dates (KAI-160).
import { timelineLayout as T } from '@freero/shared';

export type Grid = T.Grid;
export type Member = T.Member;
export type MemberInput = T.MemberInput;
export type TimelinePlan = T.TimelinePlan;
export const {
  LABEL_W,
  HEAD_H,
  ROW_H,
  BAR_H,
  LANE_PAD,
  MIN_ROWS,
  STUB_W,
  MIN_DAYS,
  MAX_DAYS,
  PX_PER_DAY,
  DEFAULT_DAYS,
  MIN_RANGE,
  CARD_BACK,
  HORIZON_W,
  LANE_COLORS,
  HORIZON_PAD,
  HORIZON_LABELS,
  horizonsOf,
  horizonOf,
  horizonAt,
  horizonStart,
  isMemberType,
  laneRows,
  laneHeight,
  gridOf,
  dayX,
  dayAt,
  laneAt,
  barSpan,
  datesOf,
  planTimeline,
  rangeFor,
} = T;
