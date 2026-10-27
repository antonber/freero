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

  // Act-now tool: picking it opens the file picker (still inside the click's user activation);
  // the current tool stays. Chosen images land in a free spot near the viewport center (never
  // on top of existing content), as a grid when several.
  onSelect(editor) {
    void pickImageFiles(true).then((files) => insertImageFiles(editor, files, null));
  },
});
