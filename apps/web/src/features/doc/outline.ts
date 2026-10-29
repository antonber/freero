// How a doc item reads in the board outline: the doc it shows, by address. Its text is the doc's
// (read it as the doc, with the reader's access to it: the API's /docs/<id>, MCP read_doc), never
// copied into the board's outline — a board reader may not be allowed to read the doc.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    doc: (el) => ({ text: '', fields: { url: typeof (el as { uri?: unknown }).uri === 'string' ? (el as { uri: string }).uri : '' } }),
  },
});
