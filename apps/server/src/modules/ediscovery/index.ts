// Public API of modules/ediscovery [S2]: eDiscovery cases and their legal holds (#157). Its routes.ts
// and init.ts are the entry points; the hold itself is kept by modules/boards (placeLegalHold …).
export { createCase, changeCase, releaseCase, listCases, getCaseDetail, requestCaseExport, processCaseExports, heldAuditChains } from './service';
