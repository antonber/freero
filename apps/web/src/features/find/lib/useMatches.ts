import { useMemo } from 'react';
import { useCollection, useDock, useElements, usePeople, useViewHidden, type Editor } from '@engine';
import { boardSources, commentPeopleIds, PANEL_ID, search, type Match } from './search';
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
  // Comment authors by their current names, as the comments feature shows them (KAI-201).
  const ids = useMemo(() => (open ? commentPeopleIds(comments) : []), [open, comments]);
  const people = usePeople(ids);
  return useMemo(
    () => (open && query.trim() ? search(boardSources(editor, elements, comments, people), query, { caseSensitive }) : NONE),
    // viewHidden: items hidden for me drop out of the results. revision: a replace changed texts
    // outside the elements map (table cells).
    [open, editor, elements, comments, people, query, caseSensitive, viewHidden, revision],
  );
}
