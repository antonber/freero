// This unit's interface text (docs/design/i18n.md): English in locales/en.json, translations beside it.
import { defineMessages } from './i18n';
import en from './locales/en.json';

export const t = defineMessages('ui', en);
