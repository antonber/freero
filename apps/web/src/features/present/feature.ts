import { defineFeature } from '@engine';

export default defineFeature({
  name: 'present',
  description:
    'Presentation mode: steps through frames full-screen without chrome; collaborators can follow the presenter. A laser pointer anyone can use (presence only), and presenter notes per frame shown only on the presenter’s screen.',
  owns: ['presenterNotes'],
});
