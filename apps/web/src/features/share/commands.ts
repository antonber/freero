// Content shared into the installed app (KAI-218): the app's /share page lets the person pick a
// board and opens it with `?shared=1`; this places what is waiting (Host.takeShared, handed over
// once, so a later navigation or reload never places it twice). Images go to the image feature,
// a link or text to the paste importers (a link card, a sticky / text box) — never created here.
import { defineCommands } from '@engine';

export default defineCommands([
  {
    id: 'share.receive',
    label: 'Place shared content',
    urlParam: 'shared',
    run(editor) {
      const shared = editor.host.takeShared?.();
      if (!shared) return;
      if (shared.images.length) editor.runCommand('image.insertStored', { urls: shared.images });
      const text = shared.link ?? shared.text ?? null;
      if (text) {
        const at = editor.getViewportCenter();
        void editor.importData({ files: [], text, html: null }, { x: at.x, y: at.y + (shared.images.length ? 320 : 0) });
      }
      const n = shared.images.length + (text ? 1 : 0);
      if (n) editor.host.notify(`Added what you shared${shared.title ? `: ${shared.title}` : ''}`, 'success');
    },
  },
]);
