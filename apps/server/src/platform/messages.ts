// The platform's own interface text (the shared email layout; docs/design/i18n.md).
import { defineMessages } from './i18n';
import en from './locales/en.json';

export const t = defineMessages(import.meta.url, en);
