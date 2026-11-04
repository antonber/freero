// modules/workspaces' invite emails, in the recipient's language (docs/design/i18n.md).
import { defineMessages } from '../../platform/i18n';
import en from './locales/en.json';

export const t = defineMessages(import.meta.url, en);
