// [additive, KAI-162] <DocEditor doc={…} />: a doc's document, edited together in real time. The
// editor (BlockNote core) is loaded with import() the first time a doc is shown, so boards and the
// dashboard never download it. `doc` comes from useObjectDoc (one Yjs doc and socket per doc,
// never the board's), so the editor's undo history and the board's are separate.
import { lazy, Suspense, type ReactNode } from 'react';
import type { DocBlock } from '@freero/shared';
import type { ObjectDocStore } from '../store/ObjectDocStore';

/** What the page or board item can do with the editor it shows. */
export interface DocHandle {
  /** The document as plain blocks (BlockNote JSON). */
  blocks(): DocBlock[];
  /** The document as Markdown. */
  markdown(): string;
  /** Inserts Markdown after the block with the cursor (else at the end). */
  insertMarkdown(markdown: string): void;
  /** Inserts a live board embed (`freero://board/<id>[#<frame>]`) after the cursor's block. */
  insertBoardEmbed(uri: string): void;
  /** The block the cursor is in, or null. */
  currentBlockId(): string | null;
  /** Scrolls to a block and puts the cursor there. */
  revealBlock(id: string): void;
  focus(): void;
}

export interface DocEditorProps {
  doc: ObjectDocStore;
  /** Shown on this person's cursor to the others (the server stamps the real identity). */
  user: { name: string; color: string };
  editable: boolean;
  onReady?(handle: DocHandle | null): void;
  /** Renders a live board embed block (the reader's access is checked on that board). */
  renderBoardEmbed?(uri: string): ReactNode;
  /** Stores a pasted / picked image; resolves to its URL. */
  uploadImage?(file: File): Promise<string>;
  /** The slash menu's "Live board": asks for the board or frame to embed (null: cancelled). */
  pickBoardEmbed?(): Promise<string | null>;
  /** Blocks with open comment threads (highlighted), and the one in focus. */
  commentedBlocks?: readonly string[];
  activeBlock?: string | null;
  label?: string;
}

const Impl = lazy(() => import('./DocEditorImpl'));

export function DocEditor(props: DocEditorProps) {
  return (
    <Suspense fallback={<div className="fr-doc-editor fr-doc-editor--loading" aria-busy="true" />}>
      <Impl {...props} />
    </Suspense>
  );
}
