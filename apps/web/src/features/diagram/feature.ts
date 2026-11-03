import { defineFeature } from '@engine';

export default defineFeature({
  name: 'diagram',
  description:
    'Diagrams: one object that owns its shapes and connectors and keeps them laid out live (top to bottom, left to right, tree, org chart or manual) — steps added, removed, resized or connected reflow it, steps moved by hand stay put —, with named layers to show, hide and lock, and a focus mode.',
});
