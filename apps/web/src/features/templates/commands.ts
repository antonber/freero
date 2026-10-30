import { BookmarkPlus, LayoutTemplate } from 'lucide-react';
import { defineCommands } from '@engine';
import { DOCK_ID, addTemplate } from './lib/insert';
import { loadTemplates } from './lib/catalog/load';
import { SAVE_DIALOG_ID } from './lib/saved';

export default defineCommands([
  {
    id: 'templates.open',
    icon: LayoutTemplate,
    label: 'Templates…',
    menus: ['board'],
    run(editor) {
      editor.openDock(editor.getDock() === DOCK_ID ? null : DOCK_ID);
    },
  },
  {
    // For other features (a retro's setup): args { id } of a built-in template. No menus.
    id: 'templates.insert',
    label: 'Insert a template',
    run(editor, args) {
      loadTemplates()
        .then((all) => {
          const def = all.find((t) => t.id === args?.id);
          return def ? addTemplate(editor, def) : null;
        })
        .catch(() => editor.host.notify('Could not load the template. Check your connection and try again.', 'error'));
    },
  },
  {
    // Deep link /board/<id>?template=<template id>: how a new board starts from a template link
    // (the dashboard's /app?template=…, which the marketing site's "Use this template" opens after
    // sign-up). An empty board gets the template; a board that already has content (the same link
    // reloaded after it was added) only opens the panel, so following it twice never adds a copy.
    id: 'templates.fromLink',
    label: 'Start from a template',
    urlParam: 'template',
    run(editor, args) {
      const def = TEMPLATES.find((t) => t.id === args?.template);
      if (!def || editor.getElements().length) return editor.openDock(DOCK_ID);
      addTemplate(editor, def).catch(() => editor.host.notify(`Could not load “${def.name}”. Check your connection and try again.`, 'error'));
    },
  },
  // Saving copies content into the user's own template library (never writes the board), so
  // anyone who can see the board can do it — like copying — unless the board's workspace doesn't
  // let this user copy its content (Host.board.canExport; the server enforces it too).
  {
    id: 'templates.saveBoard',
    icon: BookmarkPlus,
    label: 'Save board as template…',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => editor.host.board.canExport !== false && editor.getElements().length > 0,
    run(editor) {
      editor.openPanel(SAVE_DIALOG_ID, { scope: 'board' });
    },
  },
  {
    id: 'templates.saveSelection',
    icon: BookmarkPlus,
    label: 'Save as template…',
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => editor.host.board.canExport !== false && editor.getSelection().length > 0,
    run(editor) {
      editor.openPanel(SAVE_DIALOG_ID, { scope: 'selection' });
    },
  },
]);
