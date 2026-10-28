import { Copy, ListOrdered, Moon, Sun } from 'lucide-react';
import type { CodeElement } from '@freero/shared';
import { defineFormat } from '@engine';
import { IconButton, Select, type SelectOption } from '@ui';
import { AUTO, LANGUAGES, PLAIN } from './lib/languages';
import { copyCode } from './lib/actions';

const OPTIONS: SelectOption<string>[] = [
  { value: AUTO, label: 'Auto-detect' },
  ...LANGUAGES.map((l) => ({ value: l.id, label: l.label })),
  { value: PLAIN, label: 'Plain text' },
];

/** Code blocks: language, line numbers, light / dark paper, copy. */
export default defineFormat({
  id: 'code.format',
  order: 10,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'code'),
  Component: ({ editor, selection }) => {
    const blocks = selection as CodeElement[];
    const patchAll = (patch: Partial<CodeElement>) => editor.updateMany(blocks.map((b) => ({ id: b.id, patch })));
    const language = blocks.every((b) => b.language === blocks[0].language) ? blocks[0].language : '';
    const numbered = blocks.every((b) => b.lineNumbers);
    const dark = blocks.every((b) => b.theme === 'dark');
    return (
      <>
        <Select
          size="sm"
          variant="ghost"
          aria-label="Language"
          placeholder="Mixed"
          options={OPTIONS}
          value={language}
          onChange={(v) => patchAll({ language: v })}
        />
        <IconButton icon={ListOrdered} label="Line numbers" size={32} active={numbered} onClick={() => patchAll({ lineNumbers: !numbered })} />
        <IconButton
          icon={dark ? Sun : Moon}
          label={dark ? 'Light background' : 'Dark background'}
          size={32}
          onClick={() => patchAll({ theme: dark ? 'light' : 'dark' })}
        />
        {blocks.length === 1 && <IconButton icon={Copy} label="Copy code" size={32} onClick={() => void copyCode(editor, blocks[0].code)} />}
      </>
    );
  },
});
