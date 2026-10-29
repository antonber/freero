import { memo } from 'react';
import { isAnonymousAuthor, type BoardElement, type PrivateModeSession } from '@freero/shared';
import { defineDecoration, useCollection, useEditor, useGonePeople, usePeople } from '@engine';
import { COLLECTION, authorLabel, authorLabelsOn, privateModeRunning, type AuthorLabels } from './lib/authors';

/** Below this zoom the label is an unreadable speck. */
const MIN_ZOOM = 0.3;

const Label = memo(function Label({ element }: { element: BoardElement }) {
  const editor = useEditor();
  const privateRunning = privateModeRunning(useCollection<PrivateModeSession>('privateMode'));
  const ids = element.createdBy && !isAnonymousAuthor(element.createdBy) ? [element.createdBy] : [];
  const people = usePeople(ids);
  const gone = useGonePeople(ids);
  const text = authorLabel(element, { privateRunning, layer: editor.layerOf(element.id), people, gone });
  if (!text) return null;
  const s = Math.max(0.6, Math.min(2, Math.min(element.w, element.h) / 200));
  return (
    <div className="fr-sticky-author" style={{ ['--s' as string]: s }} title={`Written by ${text}`}>
      {text}
    </div>
  );
});

/**
 * Who wrote each sticky, in its top-left corner, when the board's "Show sticky authors" is on. Drawn
 * inside the sticky's wrapper, so it moves, culls and exports with it. It sits in the paper's top
 * padding, clear of the text and of the tag chips at the bottom.
 */
const StickyAuthor = memo(function StickyAuthor({ element, zoom }: { element: BoardElement; zoom: number }) {
  const on = authorLabelsOn(useCollection<AuthorLabels>(COLLECTION));
  if (!on || zoom < MIN_ZOOM) return null;
  return <Label element={element} />;
});

export default defineDecoration({
  id: 'sticky.author',
  appliesTo: (el) => el.type === 'sticky',
  Component: StickyAuthor,
});
