// Operators hear about new problem reports by email, or a report waits unread until someone happens
// to open the console. At most one email per operator per ALERT_WINDOW_MS: the first report of a
// quiet spell is mailed at once; reports during the window are mailed once it has passed (the
// problems:alerts job), in one email. The email says only how many reports are new (untriaged) and
// links to the console: the mail provider is a third party, so nothing a reporter sent (note,
// address, diagnostics, screenshot) goes in it.
//
// The throttle is the problem_alerts row per address, claimed with one conditional upsert
// (repo.claimAlert), so two reports at once, or two instances, send one email, not two.
import { getConfig } from '../../platform/config';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import * as repo from './repo';

export const ALERT_WINDOW_MS = 15 * 60_000;

function alertMail(count: number) {
  const subject = count === 1 ? '1 new problem report' : `${count} new problem reports`;
  return renderMail({
    subject,
    title: subject,
    paragraphs: [
      count === 1
        ? 'Someone sent a problem report that nobody has triaged yet.'
        : `${count} problem reports that people sent are waiting to be triaged.`,
      'What they wrote stays in Freero: open the console to read it.',
    ],
    action: { label: 'Open problem reports', url: appUrl(null, '/operator?view=problems') },
  });
}

/**
 * Emails each operator whose last alert is older than the window, if a report still new arrived
 * since. Called when a report is filed and by the problems:alerts job; idempotent.
 */
export async function alertOperatorsOfNewProblems(now = Date.now()): Promise<number> {
  const operators = getConfig().operatorEmails;
  let sent = 0;
  let count: number | null = null;
  for (const to of operators) {
    if (!(await repo.claimAlert(to, now, now - ALERT_WINDOW_MS))) continue;
    count ??= await repo.countNew();
    // Triaged in the meantime: nothing waits, nothing to say (the claim only moves the window on).
    if (!count) continue;
    sendMailLater({ to, ...alertMail(count) });
    sent++;
  }
  return sent;
}

/** Drops the throttle rows of addresses no longer in OPERATOR_EMAILS (the job does it). */
export async function forgetFormerOperators(): Promise<void> {
  await repo.forgetAlertsExcept(getConfig().operatorEmails);
}
