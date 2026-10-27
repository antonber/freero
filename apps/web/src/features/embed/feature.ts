import { defineFeature } from '@engine';

export default defineFeature({
  name: 'embed',
  description:
    'Pasted links become preview cards (title, description, picture fetched by the server); YouTube, Vimeo and Loom links play inline after a click.',
});
