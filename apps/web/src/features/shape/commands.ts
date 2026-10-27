import { defineCommands } from '@engine';
import { armShape } from './lib/actions';

// Quick keys: jump straight to a specific shape (the Shapes tool remembers it afterwards).
export default defineCommands([
  {
    id: 'shape.rectangle',
    label: 'Rectangle',
    shortcut: 'r',
    run: (editor) => armShape(editor, 'rect'),
  },
  {
    id: 'shape.ellipse',
    label: 'Circle',
    shortcut: 'o',
    run: (editor) => armShape(editor, 'ellipse'),
  },
]);
