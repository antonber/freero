// modules/figma's page the plugin's sign-in ends on, in the reader's language (docs/design/i18n.md).
import { defineMessages } from '../../platform/i18n';
import en from './locales/en.json';

export const t = defineMessages(import.meta.url, en);
