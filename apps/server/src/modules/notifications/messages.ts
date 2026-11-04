// modules/notifications' words — the inbox, the email settings and the digest — in the reader's
// language (docs/design/i18n.md).
import { defineMessages } from '../../platform/i18n';
import en from './locales/en.json';

export const t = defineMessages(import.meta.url, en);
