// Emails moderation sends: the notice to the person an action affects (a statement of reasons with
// a signed appeal link; account mail, no opt-out), alerts to operators, and answers to reporters.
// Every string goes through renderMail, which escapes it.
import { REPORT_REASONS, type ModerationActionKind, type ReportReason } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';

export const reasonLabel = (r: ReportReason | null): string => REPORT_REASONS.find((x) => x.id === r)?.label ?? 'Other';

const quoted = (title: string | null) => `“${title || 'Untitled board'}”`;

function contactLine(): string | undefined {
  const abuse = getConfig().abuseContactEmail;
  return abuse ? `Questions about this decision: write to ${abuse}.` : undefined;
}

const WHAT: Record<ModerationActionKind, { subject: (t: string | null) => string; did: (t: string | null) => string; adverse: boolean }> = {
  'board.disable_link': {
    subject: (t) => `Link sharing turned off for ${quoted(t)}`,
    did: (t) =>
      `Freero’s moderators turned off link sharing for your board ${quoted(t)}. People you invited and your team still have access; people who only had the link don’t.`,
    adverse: true,
  },
  'board.restore_link': {
    subject: (t) => `Link sharing works again for ${quoted(t)}`,
    did: (t) => `Freero’s moderators turned link sharing back on for your board ${quoted(t)}, with the setting you had before.`,
    adverse: false,
  },
  'board.take_down': {
    subject: (t) => `${quoted(t)} was removed for review`,
    did: (t) =>
      `Freero’s moderators removed your board ${quoted(t)} while they review it. Nobody can open it for now, you included; its content is kept unchanged.`,
    adverse: true,
  },
  'board.restore': {
    subject: (t) => `${quoted(t)} is available again`,
    did: (t) => `Freero’s moderators restored your board ${quoted(t)}. Everyone who had access can open it again.`,
    adverse: false,
  },
  'board.delete': {
    subject: (t) => `${quoted(t)} was deleted`,
    did: (t) => `After reviewing your board ${quoted(t)}, which they had removed earlier, Freero’s moderators deleted it for good.`,
    adverse: true,
  },
  'upload.remove': {
    subject: () => 'An uploaded file was removed',
    did: (t) => `Freero’s moderators removed a file of yours${t ? ` shown on ${quoted(t)}` : ''}. It no longer loads anywhere it was used.`,
    adverse: true,
  },
  'upload.restore': {
    subject: () => 'An uploaded file is available again',
    did: () => 'Freero’s moderators restored a file of yours. It loads again wherever it was used.',
    adverse: false,
  },
  'upload.purge': {
    subject: () => 'A removed file was deleted',
    did: () => 'Freero’s moderators deleted a file of yours that they had removed earlier.',
    adverse: true,
  },
  'user.suspend': {
    subject: () => 'Your Freero account was suspended',
    did: () => 'Freero’s moderators suspended your account. You were signed out everywhere and can’t sign in for now.',
    adverse: true,
  },
  'user.restore': {
    subject: () => 'Your Freero account is active again',
    did: () => 'Freero’s moderators lifted the suspension of your account. You can sign in again.',
    adverse: false,
  },
};

/** Whether the action works against someone (so it can be appealed). */
export const isAdverse = (a: ModerationActionKind): boolean => WHAT[a].adverse;

/** The notice to the person an action affects. `appealPath`: their signed appeal page (adverse actions). */
export function sendActionNotice(
  to: string,
  n: { action: ModerationActionKind; reason: ReportReason; statement: string; boardTitle: string | null; appealPath: string | null; extra?: string },
): void {
  const what = WHAT[n.action];
  const paragraphs = [what.did(n.boardTitle)];
  if (n.extra) paragraphs.push(n.extra);
  if (what.adverse) paragraphs.push(`Reason: ${reasonLabel(n.reason)}.`);
  if (n.statement) paragraphs.push(n.statement);
  if (n.appealPath) paragraphs.push('If you think this is a mistake, tell us why and a moderator will review it again.');
  sendMailLater({
    to,
    ...renderMail({
      subject: what.subject(n.boardTitle),
      title: what.subject(n.boardTitle),
      paragraphs,
      action: n.appealPath ? { label: 'Review and appeal', url: appUrl(null, n.appealPath) } : undefined,
      outro: contactLine(),
    }),
  });
}

/** Tells operators there is something new in the queue. */
export function alertOperators(n: { kind: 'report' | 'appeal'; boardTitle: string; reason: ReportReason | null }): void {
  const operators = getConfig().operatorEmails;
  if (!operators.length) return;
  const subject = n.kind === 'appeal' ? `New appeal: ${quoted(n.boardTitle)}` : `New report: ${quoted(n.boardTitle)} (${reasonLabel(n.reason)})`;
  for (const to of operators)
    sendMailLater({
      to,
      ...renderMail({
        subject,
        title: subject,
        paragraphs: [n.kind === 'appeal' ? 'Someone appealed against a moderation decision.' : 'Someone reported content on Freero.'],
        action: { label: 'Open the moderation queue', url: appUrl(null, '/operator') },
      }),
    });
}

/** Answers a reporter once their report was reviewed. */
export function sendReportOutcome(to: string, n: { boardTitle: string; actioned: boolean }): void {
  const subject = `Your report about ${quoted(n.boardTitle)}`;
  sendMailLater({
    to,
    ...renderMail({
      subject,
      title: 'Thanks for your report',
      paragraphs: [
        n.actioned
          ? `We reviewed what you reported on ${quoted(n.boardTitle)} and took action.`
          : `We reviewed what you reported on ${quoted(n.boardTitle)} and found that it doesn’t break Freero’s rules, so we didn’t take action.`,
      ],
      outro: contactLine(),
    }),
  });
}

/** Answers an appeal that was reviewed and not granted (a granted one gets the restore notice). */
export function sendAppealUpheld(to: string, n: { boardTitle: string | null; note: string }): void {
  const subject = 'Your appeal was reviewed';
  sendMailLater({
    to,
    ...renderMail({
      subject,
      title: subject,
      paragraphs: ['A moderator reviewed your appeal again and kept the decision.', ...(n.note ? [n.note] : [])],
      outro: contactLine(),
    }),
  });
}
