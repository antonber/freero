// Calendar dates as whole day numbers: the timeline layout's, shared with the server
// (@freero/shared layout/timeline.ts).
import { timelineLayout as T } from '@freero/shared';

export type Tick = T.Tick;
export const { isISODate, dayOf, isoOf, addDays, localDay, weekday, mondayOf, isoWeek, axisTicks, formatRange } = T;
