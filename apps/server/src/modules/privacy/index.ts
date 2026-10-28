// Public API of modules/privacy [S2]: data exports (GDPR access and portability) — a person's own
// data, or a team workspace's. Nothing else calls in today; its routes.ts and init.ts are the
// entry points. Deletion stays with the owning modules (account deletion: modules/accounts;
// workspace deletion: modules/workspaces, behind its retention / legal-hold seam).
export {};
