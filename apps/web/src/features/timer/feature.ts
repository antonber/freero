import { defineFeature } from '@engine';

export default defineFeature({
  name: 'timer',
  description: 'One shared countdown per board: presets or a custom time, pause/+1 min/stop, and a gentle chime at zero.',
  owns: ['timer'],
});
