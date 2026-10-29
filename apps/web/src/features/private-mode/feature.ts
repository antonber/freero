import { defineFeature } from '@engine';

export default defineFeature({
  name: 'private-mode',
  description:
    'Private mode: a facilitator starts it (whole board or one frame); while on, what each participant adds is visible only to them — the server sends it to nobody else — until the facilitator reveals everything at once — anonymously if they switch it on, which the server keeps (#44).',
  owns: ['privateMode'],
});
