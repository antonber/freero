import { Paperclip } from 'lucide-react';
import { defineTool } from '@engine';
import { pickFiles } from './lib/insert';

// Act-now tool: opens the file picker; what is picked lands in a free spot near the view.
export default defineTool({
  id: 'media',
  label: 'Upload file',
  icon: Paperclip,
  order: 43,
  placement: 'more',
  onSelect: pickFiles,
});
