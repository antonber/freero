# Freero

Read ARCHITECTURE.md before changing code. This repo follows the Dune method: layers and
single writers are enforced mechanically.

- New product work = a new `apps/web/src/features/<name>/` folder: `npm run new:feature <name> -- ...`.
  No registries to edit; reserved files are discovered automatically.
- Features import only `@engine`, `@ui`, `@freero/shared` and packages. Board state is written only
  through the `Editor` (never import yjs outside `engine/store/`).
- Server: one module per area; only its `repo.ts` touches the db and its own tables.
- Before saying you're done: `npm run check` (boundaries + types + tests) must pass. If the checker
  blocks you, follow the path it names; don't add exceptions without a stated architectural reason.
- Never copy Miro's (or anyone's) assets, icons, copy or code. Freero has its own brand (`ui/tokens.css`).
- Windows dev machine; use forward-slash paths in scripts.
