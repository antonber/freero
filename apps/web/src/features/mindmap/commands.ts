import { ListTree, Network, Sparkles } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { copyOutline } from './lib/clipboard';
import { expandWithAi } from './lib/ai';
import { FROM_STICKIES_DIALOG } from './lib/constants';
import { stickiesOf } from './lib/fromStickies';
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

import { t } from './messages';
const selectedNodes = (editor: Editor) => editor.getSelection().filter((id) => isNode(editor.getElement(id)));

export default defineCommands([
  {
    // Works while typing too: commits the text and starts the child.
    id: 'mindmap.addChild',
    label: t('addChildIdea'),
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
    label: t('moveIdeaUpALevel'),
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
    label: t('addSiblingIdea'),
    shortcut: 'enter',
    menus: ['context'],
    when: (editor) => !!selectedNode(editor)?.parentId,
    run(editor) {
      const n = selectedNode(editor);
      if (n) addSibling(editor, n.id);
    },
  },
  {
    id: 'mindmap.expandAi',
    label: t('expandWithAi'),
    icon: Sparkles,
    menus: ['context'],
    palette: false,
    when: (editor) => !!selectedNode(editor) && (!!editor.host.ai || !!editor.host.aiUnavailable),
    run(editor) {
      const n = selectedNode(editor);
      if (n) expandWithAi(editor, n.id);
    },
  },
  {
    // #134: a pile of sticky notes becomes a map around the one you pick.
    id: 'mindmap.fromStickies',
    label: t('makeAMindMap'),
    icon: Network,
    menus: ['context'],
    when: (editor) => stickiesOf(editor, editor.getSelection()).length >= 2,
    disabledReason: t('selectTwoOrMoreSticky'),
    run(editor) {
      editor.openPanel(FROM_STICKIES_DIALOG, { ids: stickiesOf(editor, editor.getSelection()).map((n) => n.id) });
    },
  },
  {
    id: 'mindmap.toggleCollapse',
    label: t('collapseExpandBranch'),
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
    label: t('deleteBranch'),
    menus: ['context'],
    when: (editor) => selectedNodes(editor).length > 0,
    run(editor) {
      deleteBranches(editor, editor.getSelection());
    },
  },
  {
    // Read-only: anyone who can see the map may copy it out.
    id: 'mindmap.copyAsOutline',
    label: t('copyAsOutline'),
    icon: ListTree,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => selectedNodes(editor).length > 0,
    run(editor) {
      void copyOutline(editor, rootIdsOf(editor, selectedNodes(editor)));
    },
  },
  {
    id: 'mindmap.relayout',
    label: t('tidyUpMindMap'),
    menus: ['context'],
    when: (editor) => selectedNodes(editor).length > 0,
    run(editor) {
      relayout(editor, rootIdsOf(editor, selectedNodes(editor)));
    },
  },
]);
