import { defineFeature } from '@engine';

export default defineFeature({
  name: 'timer',
  description: 'One shared countdown per board: presets or a custom time, pause/+1 min/stop, a gentle chime at zero, and optional background music generated in the browser (no audio files) that plays in step with the countdown.',
  owns: ['timer'],
});
