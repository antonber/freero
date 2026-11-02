// Public API of modules/problems [S2]: "Report a problem" — bugs, broken things, confusion, sent by
// signed-in people with a note, an optional screenshot and diagnostics, read only by Freero's
// operators. (Abuse reports are modules/moderation.) It owns `problem_reports`; screenshots are
// uploads' private images.
//
// modules/api serves the operators' machine access (/api/v1/operator/problems, `problems:triage`)
// with these functions after checking the credential's account is an operator; modules/accounts
// deletes a person's reports with their account; modules/privacy puts them in their export.
export { listProblems, problemDetail, problemScreenshot, updateProblem, deleteProblemsOf, problemsExportOf } from './service';
// Filing one (the reporter's own routes use these too).
export { createProblem, attachScreenshot as attachProblemScreenshot } from './service';
export { sendScreenshot as sendProblemScreenshot } from './screenshot';
