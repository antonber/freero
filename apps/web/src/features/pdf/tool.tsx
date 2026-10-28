import { FileText } from 'lucide-react';
import { defineTool } from '@engine';
import { pickPdf } from './lib/actions';

// Act-now tool: opens the file picker; the document lands in a free spot near the view.
export default defineTool({
  id: 'pdf',
  label: 'PDF',
  icon: FileText,
  order: 42,
  placement: 'more',
  onSelect: pickPdf,
});
