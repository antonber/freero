import { CirclePlay, Mic } from 'lucide-react';
import { defineCommands } from '@engine';
import { LIST_ID, START_ID } from './lib/ids';
import { openWalkthrough } from './lib/playback';
import { canRecord } from './lib/recorder';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default defineCommands([
  {
    id: 'walkthrough.record',
    label: 'Record a walkthrough…',
    icon: Mic,
    menus: ['board'],
    minRole: 'editor',
    when: (editor) => !!editor.host.walkthroughs && editor.host.board.signedIn !== false && canRecord(),
    run: (editor) => editor.openPanel(START_ID),
  },
  {
    id: 'walkthrough.list',
    label: 'Walkthroughs',
    icon: CirclePlay,
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !!editor.host.walkthroughs,
    run: (editor) => editor.openDock(editor.getDock() === LIST_ID ? null : LIST_ID),
  },
  {
    // Deep link: /board/<id>?walkthrough=<wid>[&t=<ms>] (shared links, notifications about a comment).
    id: 'walkthrough.play',
    label: 'Watch a walkthrough',
    minRole: 'viewer',
    palette: false,
    urlParam: 'walkthrough',
    run(editor, args) {
      const id = args?.walkthrough;
      if (typeof id !== 'string' || !ID.test(id)) return;
      const t = Number((args?.query as Record<string, string> | undefined)?.t);
      void openWalkthrough(editor, id, Number.isFinite(t) && t > 0 ? t : 0);
    },
  },
]);
