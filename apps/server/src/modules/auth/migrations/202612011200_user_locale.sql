-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- locale: the interface language this person uses (an entry of LOCALES in @freero/shared, e.g.
-- 'de', 'pt-BR'): the app's language on every device, and the language of their emails and
-- notifications. Null until they sign up with one or the app sets it once (docs/design/i18n.md);
-- emails to accounts without one stay English, as before.
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale text;
