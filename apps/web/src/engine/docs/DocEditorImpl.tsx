// The doc editor itself (KAI-162): BlockNote's open core (MPL-2.0; never its "XL" packages) on the
// object's own Yjs document. Loaded with import() only when a doc is shown (DocEditor.tsx).
//
// Block set: BlockNote's defaults (headings, lists, checklists, tables, images, code, quotes,
// dividers, links…) plus Freero's `boardEmbed` — a LIVE frame of a board, stored as its address
// only and rendered by the host (`renderBoardEmbed`) from that board's own doc and connection, with
// the reader's access checked on the board itself (KAI-152).
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, type PartialBlock } from '@blocknote/core';
import { CollaborationExtension } from '@blocknote/core/yjs';
import { createReactBlockSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/ariakit';
import '@blocknote/ariakit/style.css';
import { docToMarkdown, markdownToDoc, parseObjectUri, type DocBlock } from '@freero/shared';
import type { ObjectDocStore } from '../store/ObjectDocStore';
import type { DocEditorProps, DocHandle } from './DocEditor';
import './docs.css';

const EmbedContext = createContext<((uri: string) => ReactNode) | undefined>(undefined);

function BoardEmbedSlot({ uri }: { uri: string }) {
  const render = useContext(EmbedContext);
  return (
    <div className="fr-doc-embed" contentEditable={false} data-fr-doc-embed="">
      {render ? render(uri) : <div className="fr-doc-embed__plain">{uri}</div>}
    </div>
  );
}

const boardEmbed = createReactBlockSpec(
  { type: 'boardEmbed', propSchema: { uri: { default: '' } }, content: 'none' },
  { render: ({ block }) => <BoardEmbedSlot uri={String(block.props.uri ?? '')} /> },
);

export const docSchema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, boardEmbed: boardEmbed() } });
type Editor = ReturnType<typeof useEditorFor>;

/** A pasted Freero board or frame address (and nothing else) becomes a live embed. */
function boardAddress(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const ref = parseObjectUri(t, [window.location.origin]);
  if (!ref) return null;
  if (ref.type === 'board') return `freero://board/${ref.id}`;
  if (ref.type === 'element') return `freero://board/${ref.boardId}#${ref.id}`;
  return null;
}

function useEditorFor(store: ObjectDocStore, user: { name: string; color: string }, uploadImage?: (file: File) => Promise<string>) {
  return useCreateBlockNote(
    {
      schema: docSchema,
      extensions: [CollaborationExtension(store.collaboration(user))],
      ...(uploadImage ? { uploadFile: (file: File) => uploadImage(file) } : {}),
      pasteHandler: ({ event, editor, defaultPasteHandler }) => {
        const uri = boardAddress(event.clipboardData?.getData('text/plain') ?? '');
        if (!uri) return defaultPasteHandler();
        const at = editor.getTextCursorPosition().block;
        editor.insertBlocks([{ type: 'boardEmbed', props: { uri } }], at, 'after');
        return true;
      },
    },
    [store],
  );
}

function handleFor(editor: Editor): DocHandle {
  const blocks = () => editor.document as unknown as DocBlock[];
  const after = () => {
    try {
      return editor.getTextCursorPosition().block;
    } catch {
      const doc = editor.document;
      return doc[doc.length - 1];
    }
  };
  const insert = (list: DocBlock[]) => {
    if (!list.length) return;
    const ref = after();
    if (!ref) return;
    const blocks = list as unknown as PartialBlock<typeof docSchema.blockSchema>[];
    // On an empty line (where the slash menu was typed), the new blocks take its place.
    const empty = ref.type === 'paragraph' && Array.isArray(ref.content) && ref.content.length === 0 && !ref.children.length;
    if (empty) editor.replaceBlocks([ref], blocks);
    else editor.insertBlocks(blocks, ref, 'after');
  };
  return {
    blocks,
    markdown: () => docToMarkdown(blocks()),
    insertMarkdown: (md) => insert(markdownToDoc(md)),
    insertBoardEmbed: (uri) => insert([{ type: 'boardEmbed', props: { uri } }]),
    currentBlockId: () => {
      try {
        return editor.getTextCursorPosition().block.id;
      } catch {
        return null;
      }
    },
    revealBlock: (id) => {
      const el = editor.domElement?.querySelector(`[data-id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (editor.getBlock(id)) editor.setTextCursorPosition(id, 'start');
    },
    focus: () => editor.focus(),
  };
}

/** Highlights the blocks with open comment threads (ids are BlockNote's: letters, digits, dashes). */
function highlightCss(ids: readonly string[] | undefined, active: string | null | undefined): string {
  const safe = (ids ?? []).filter((id) => /^[\w-]{1,64}$/.test(id));
  const sel = safe.map((id) => `.fr-doc-editor .bn-block-outer[data-id="${id}"] > .bn-block > .bn-block-content`).join(',\n');
  // Forced colours drop backgrounds: an outline marks commented blocks there.
  let css = safe.length ? `${sel} { background: var(--fr-doc-comment-bg); border-radius: 4px; }\n@media (forced-colors: active) { ${sel} { outline: 1px dashed CanvasText; } }\n` : '';
  if (active && /^[\w-]{1,64}$/.test(active))
    css += `.fr-doc-editor .bn-block-outer[data-id="${active}"] > .bn-block > .bn-block-content { background: var(--fr-doc-comment-active-bg); box-shadow: inset 3px 0 0 var(--fr-doc-comment-mark); }\n`;
  return css;
}

export default function DocEditorImpl({ doc, user, editable, onReady, renderBoardEmbed, uploadImage, pickBoardEmbed, commentedBlocks, activeBlock, label }: DocEditorProps) {
  const editor = useEditorFor(doc, user, uploadImage);
  const handle = useMemo(() => handleFor(editor), [editor]);
  useEffect(() => {
    onReady?.(handle);
    return () => onReady?.(null);
  }, [handle, onReady]);

  const getItems = useMemo(
    () => async (query: string) => {
      const items = getDefaultReactSlashMenuItems(editor);
      if (pickBoardEmbed)
        items.push({
          title: 'Live board',
          subtext: 'A board or one of its frames, always up to date',
          aliases: ['board', 'frame', 'embed', 'freero'],
          group: 'Freero',
          onItemClick: () => {
            void pickBoardEmbed().then((uri) => uri && handle.insertBoardEmbed(uri));
          },
        });
      return filterSuggestionItems(items, query);
    },
    [editor, pickBoardEmbed, handle],
  );

  return (
    <EmbedContext.Provider value={renderBoardEmbed}>
      <div className="fr-doc-editor" aria-label={label}>
        <style>{highlightCss(commentedBlocks, activeBlock)}</style>
        <BlockNoteView editor={editor} editable={editable} theme="light" slashMenu={false}>
          <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
        </BlockNoteView>
      </div>
    </EmbedContext.Provider>
  );
}
