// Public API of modules/importers [S2] (#62; docs/design/importers.md): boards read from another
// whiteboard's API with the person's own token. Owns no table: nothing of an import is kept.
import { getConfig } from '../../platform/config';

/** "Import from Miro" is offered (the operator didn't turn it off with MIRO_IMPORT=off). */
export const miroImportOffered = (): boolean => getConfig().miroImport !== null;
