// The person's app theme from the board (Host.colorTheme: the app keeps it with their account).
// The board menu cycles it; the command palette also offers each choice by name. Board content
// keeps its colours either way (engine canvas/theme.ts).
import { Monitor, Moon, Sun } from 'lucide-react';
import { defineCommands, type ColorThemeChoice, type CommandDefinition, type Editor } from '@engine';

import { t as tr } from './messages';
const NAMES: Record<ColorThemeChoice, string> = { system: tr('sameAsDevice'), light: 'Light', dark: 'Dark' };
const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const NEXT: Record<ColorThemeChoice, ColorThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const available = (editor: Editor) => !!editor.host.colorTheme;

const choose = (theme: ColorThemeChoice): CommandDefinition => ({
  id: `appearance.${theme}`,
  icon: ICONS[theme],
  label: theme === 'system' ? tr('themeSameAsDevice') : tr('themeTheme', { theme: NAMES[theme].toLowerCase() }),
  minRole: 'viewer',
  palette: true,
  when: available,
  run: (editor) => editor.host.colorTheme?.set(theme),
});

export default defineCommands([
  {
    id: 'appearance.cycle',
    icon: Moon,
    label: tr('theme'),
    menus: ['board'],
    minRole: 'viewer',
    // It cycles; the palette lists the three choices below instead.
    palette: false,
    when: available,
    detail: (editor) => {
      const t = editor.host.colorTheme?.get();
      return t ? NAMES[t] : undefined;
    },
    run(editor) {
      const host = editor.host.colorTheme;
      if (host) host.set(NEXT[host.get()]);
    },
  },
  choose('system'),
  choose('light'),
  choose('dark'),
]);
