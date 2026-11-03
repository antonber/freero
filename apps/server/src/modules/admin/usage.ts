// Usage trends of team workspaces (#65): the admin:usage-rollup job records each workspace's
// counts once per UTC day (active people over 7 / 30 days, boards and docs created that day,
// members and guests, API / MCP calls by app from the audit log). An upsert per (workspace, day):
// a second run the same day replaces that day's row, never adds to it. Counts only.
import { USAGE_HISTORY_MAX_DAYS, type UsageDay } from '@freero/shared';
import { logError } from '../../platform/log';
import { auditCountsBy } from '../audit/index';
import { boardsCreatedIn, workspaceBoardStats } from '../boards/index';
import { allTeamWorkspaceIds, workspaceAdminFacts } from '../workspaces/index';
import * as repo from './repo';
import { csvField } from './service';

const DAY_MS = 86_400_000;
export const USAGE_ROLLUP_LOCK_KEY = 7_202_611_272; // arbitrary, constant across releases

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** One workspace's counts for the UTC day of `now` (as of `now`). */
export async function measureDay(workspaceId: string, now: number): Promise<UsageDay> {
  const start = Date.parse(`${dayOf(now)}T00:00:00Z`);
  const [stats, created, facts, calls] = await Promise.all([
    workspaceBoardStats(workspaceId, now),
    boardsCreatedIn(workspaceId, start, start + DAY_MS),
    workspaceAdminFacts(workspaceId),
    auditCountsBy(workspaceId, 'api.call', start, start + DAY_MS, 'credentialName'),
  ]);
  return {
    day: dayOf(now),
    activeUsers7d: stats.active7d,
    activeUsers30d: stats.active30d,
    boardsCreated: created.boards,
    docsCreated: created.docs,
    members: facts.members.filter((m) => m.role !== 'guest').length,
    guests: facts.members.filter((m) => m.role === 'guest').length,
    apiCalls: Object.fromEntries(calls),
  };
}

/** One round: today's row for every team workspace, and days past the history pruned. The caller holds the lock. */
export async function rollUpUsage(now = Date.now()): Promise<number> {
  let n = 0;
  for (const id of await allTeamWorkspaceIds()) {
    try {
      await repo.upsertDay(id, await measureDay(id, now), now);
      n++;
    } catch (e) {
      logError(`admin: usage rollup of workspace ${id} failed`, e);
    }
  }
  await repo.pruneBefore(dayOf(now - USAGE_HISTORY_MAX_DAYS * DAY_MS));
  return n;
}

/** The last `days` days of a workspace's rollups, oldest first. */
export function usageHistory(workspaceId: string, days: number, now = Date.now()): Promise<UsageDay[]> {
  return repo.daysOf(workspaceId, dayOf(now - (days - 1) * DAY_MS));
}

export const USAGE_CSV_COLUMNS = ['day', 'active_people_7d', 'active_people_30d', 'boards_created', 'docs_created', 'members', 'guests', 'api_calls', 'api_calls_by_app'];

/** The history as CSV (cells can't become spreadsheet formulas: csvField). */
export function usageCsv(days: UsageDay[]): string {
  const lines = days.map((d) =>
    [
      d.day,
      d.activeUsers7d,
      d.activeUsers30d,
      d.boardsCreated,
      d.docsCreated,
      d.members,
      d.guests,
      Object.values(d.apiCalls).reduce((a, b) => a + b, 0),
      Object.entries(d.apiCalls)
        .map(([app, n]) => `${app}: ${n}`)
        .join('; '),
    ]
      .map(csvField)
      .join(','),
  );
  return `${USAGE_CSV_COLUMNS.join(',')}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}
