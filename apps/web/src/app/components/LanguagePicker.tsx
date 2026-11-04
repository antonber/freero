// The interface language (#5; docs/design/i18n.md): every shipped language by its own name. Signed
// in, the choice is saved to the account (it follows the person to every device and their emails);
// signed out, it's this browser's. The page reloads in the new language.
import { useState } from 'react';
import { LOCALE_NAMES, LOCALES, type Locale } from '@freero/shared';
import { getLocale, Select, useToast } from '@ui';
import { useAuth } from '../auth/AuthContext';
import { switchLocale } from '../i18n/locale';
import { t } from '../messages';

const OPTIONS = LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }));

export function LanguagePicker({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { user, updateProfile } = useAuth();
  const notify = useToast();
  const [value, setValue] = useState<Locale>(getLocale());
  const choose = (next: Locale) => {
    if (next === value) return;
    setValue(next);
    switchLocale(next, user ? (locale) => updateProfile({ locale }) : undefined).catch(() => {
      setValue(getLocale());
      notify(t('language.couldNotSave'), 'error');
    });
  };
  return <Select<Locale> size={size} aria-label={t('language.label')} options={OPTIONS} value={value} onChange={choose} width={200} />;
}
