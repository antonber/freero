// System / Light / Dark: applies at once here (and in this browser's other tabs) and is saved to the
// account, so it follows the person to their other devices (app/lib/theme.ts).
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ColorThemePreference } from '@freero/shared';
import { SegmentedControl, useToast } from '@ui';
import { useAuth } from '../auth/AuthContext';
import { getThemePreference, setThemePreference, useThemePreference } from '../lib/theme';

import { t } from '../messages';
const OPTIONS = [
  { value: 'system' as const, icon: Monitor, label: t('system') },
  { value: 'light' as const, icon: Sun, label: t('light') },
  { value: 'dark' as const, icon: Moon, label: t('dark') },
];
const ICON_ONLY = OPTIONS.map(({ value, icon, label }) => ({ value, icon, title: label }));

export function useChooseTheme(): (next: ColorThemePreference) => void {
  const { user, updateProfile } = useAuth();
  const notify = useToast();
  return (next) => {
    const before = getThemePreference();
    setThemePreference(next);
    if (!user) return;
    updateProfile({ theme: next }).catch(() => {
      setThemePreference(before);
      notify(t('couldNotSaveYourTheme'), 'error');
    });
  };
}

export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const value = useThemePreference();
  const choose = useChooseTheme();
  return <SegmentedControl size="sm" aria-label={t('theme')} options={compact ? ICON_ONLY : OPTIONS} value={value} onChange={choose} />;
}
