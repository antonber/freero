import { useMemo } from 'react';
import { useCollection, useDock, useElements, useViewHidden, type Editor } from '@engine';
import { boardSources, PANEL_ID, search, type Match } from './search';
import { useFindUi } from './state';

const NONE: Match[] = [];

/** Live matches of the current query while the find panel is open (empty otherwise). */
export function useMatches(editor: Editor): Match[] {
  const open = useDock() === PANEL_ID;
  const elements = useElements();
  const comments = useCollection<unknown>('comments');
  const viewHidden = useViewHidden();
  const query = useFindUi(editor, (s) => s.query);
  const caseSensitive = useFindUi(editor, (s) => s.caseSensitive);
  const revision = useFindUi(editor, (s) => s.revision);
  return useMemo(
    () => (open && query.trim() ? search(boardSources(editor, elements, comments), query, { caseSensitive }) : NONE),
    // viewHidden: items hidden for me drop out of the results. revision: a replace changed texts
    // outside the elements map (table cells).
    [open, editor, elements, comments, query, caseSensitive, viewHidden, revision],
  );
}
