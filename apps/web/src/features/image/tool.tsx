import { ImageUp } from 'lucide-react';
import { defineTool } from '@engine';
import { pickImageFiles } from './lib/files';
import { insertImageFiles } from './lib/insert';

export default defineTool({
  id: 'image',
  label: 'Upload image',
  icon: ImageUp,
  order: 80,
  placement: 'main',

  // Not a drawing tool: activating it opens the file picker (still inside the click's user
  // activation) and hands control straight back to select. Chosen images land at the
  // viewport center, laid out as a grid when there are several.
  onActivate(editor) {
    void pickImageFiles(true).then((files) => insertImageFiles(editor, files, editor.getViewportCenter()));
    queueMicrotask(() => {
      if (editor.getToolId() === 'image') editor.setTool('select');
    });
  },
});
