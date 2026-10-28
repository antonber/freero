import { defineFeature } from '@engine';

export default defineFeature({
  name: 'facilitation',
  description:
    'Facilitator controls: one editor runs a session and can lock the board (participants comment only), limit what participants may add, make everyone follow their view and hide cursors. The server enforces the lock and the limits; the session ends when the facilitator leaves.',
  owns: ['facilitation'],
});
