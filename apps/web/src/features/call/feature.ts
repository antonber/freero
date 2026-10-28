import { defineFeature } from '@engine';

export default defineFeature({
  name: 'call',
  description: 'A board’s call link (a meeting URL or its own Jitsi room): Join call in the top bar, with who is in it.',
  // Bumped after the link changes, so every open board fetches the new one.
  owns: ['call'],
});
