import { defineCommands, type Editor } from '@engine';
import {
  addChild,
  addSibling,
  currentIndex,
  deleteBranches,
  isNode,
  promote,
  relayout,
  rootIdsOf,
  selectedNode,
  toggleCollapse,
} from './lib/actions';

const selectedNodes = (editor: Editor) => editor.getSelection().filter((id) => isNode(editor.getElement(id)));

export default defineCommands([
  {
    // Works while typing too: commits the text and starts the child.
    id: 'mindmap.addChild',
    label: 'Add child idea',
    shortcut: 'tab',
    menus: ['context'],
    when: (editor) => !!selectedNode(editor),
    run(editor) {
      const n = selectedNode(editor);
      if (n) addChild(editor, n.id);
    },
  },
  {
    // Works while typing too (Tab commands reach the editor mid-edit).
    id: 'mindmap.promote',
    label: 'Move idea up a level',
    shortcut: 'shift+tab',
    menus: ['context'],
    when: (editor) => {
      const n = selectedNode(editor);
      const p = n?.parentId ? editor.getElement(n.parentId) : undefined;
      return !!p && isNode(p) && !!p.parentId;
    },
    run(editor) {
      const n = selectedNode(editor);
      if (n) promote(editor, n.id);
    },
  },
  {
    // Shown for discoverability; the Enter key itself reaches the element definition's
    // onKeyDown first (before the engine's own Enter = edit text).
    id: 'mindmap.addSibling',
    label: 'Add sibling idea',
    shortcut: 'enter',
    menus: ['context'],
    when: (editor) => !!selectedNode(editor)?.parentId,
    run(editor) {
      const n = selectedNode(editor);
      if (n) addSibling(editor, n.id);
    },
  },
  {
    id: 'mindmap.toggleCollapse',
    label: 'Collapse / expand branch',
    menus: ['context'],
    when: (editor) => {
      const n = selectedNode(editor);
      return !!n && !!currentIndex(editor).kids.get(n.id)?.length;
    },
    run(editor) {
      const n = selectedNode(editor);
      if (n) toggleCollapse(editor, n.id);
    },
  },
  {
    id: 'mindmap.deleteBranch',
    label: 'Delete branch',
    menus: ['context'],
    when: (editor) => selectedNodes(editor).length > 0,
    run(editor) {
      deleteBranches(editor, editor.getSelection());
    },
  },
  {
    id: 'mindmap.relayout',
    label: 'Tidy up mind map',
    menus: ['context'],
    when: (editor) => selectedNodes(editor).length > 0,
    run(editor) {
      relayout(editor, rootIdsOf(editor, selectedNodes(editor)));
    },
  },
]);
