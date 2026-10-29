#!/usr/bin/env node
// Scaffold a Freero feature folder in house style.
//
//   npm run new:feature <name> -- [--element <type>] [--tool] [--format] [--panel <slot>] [--commands] [--decoration] [--outline] [--importer] [--owns a,b]
//
// Examples:
//   npm run new:feature sticky -- --element sticky --tool --format
//   npm run new:feature comments -- --tool --panel dock-right --commands --owns comments

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = process.argv.slice(2);
const name = args[0];
const flag = (f) => args.includes(`--${f}`);
const value = (f) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: npm run new:feature <kebab-name> -- [--element <type>] [--tool] [--format] [--panel <slot>] [--commands] [--decoration] [--outline] [--importer] [--owns a,b]');
  process.exit(1);
}

const dir = path.join(ROOT, 'apps/web/src/features', name);
if (fs.existsSync(dir)) {
  console.error(`features/${name} already exists.`);
  process.exit(1);
}

const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const Pascal = camel[0].toUpperCase() + camel.slice(1);
const owns = (value('owns') ?? '').split(',').filter(Boolean);
const elementType = value('element');
const panelSlot = value('panel') ?? (flag('panel') ? 'topbar-right' : null);

const files = {};

files['feature.ts'] = `import { defineFeature } from '@engine';

export default defineFeature({
  name: '${name}',
  description: 'TODO: one line on what ${name} lets people do.',${owns.length ? `\n  owns: [${owns.map((o) => `'${o}'`).join(', ')}],` : ''}
});
`;

if (elementType) {
  files['element.tsx'] = `import { defineElement, ElementText } from '@engine';
import './${name}.css';

export default defineElement({
  type: '${elementType}',
  // How Layers, Find and "Select only" name it (TODO: and an \`icon\` from lucide-react).
  label: { one: '${elementType[0].toUpperCase()}${elementType.slice(1)}', many: '${elementType[0].toUpperCase()}${elementType.slice(1)}s' },
  resize: 'free',
  minSize: { w: 40, h: 40 },
  defaults: () => ({
    // TODO: every required field of the '${elementType}' element except x/y.
  } as any),
  Component: ({ element }) => (
    <div className="fr-${name}" style={{ width: element.w, height: element.h }}>
      {/* <ElementText element={element} field="text" /> */}
    </div>
  ),
});
`;
  files[`${name}.css`] = `.fr-${name} {\n  position: relative;\n}\n`;
}

if (flag('tool')) {
  files['tool.tsx'] = `import { defineTool } from '@engine';
import { Square } from 'lucide-react';

export default defineTool({
  id: '${name}',
  label: '${Pascal}',
  icon: Square, // TODO: pick a lucide-react icon
  order: 50,
  placement: 'main',
  onPointerDown({ editor, point }) {
    // TODO: create on click, e.g. editor.create({ type: '${elementType ?? name}', x: point.x, y: point.y, ... }, { select: true });
    editor.setTool('select');
  },
});
`;
}

if (flag('format')) {
  files['format.tsx'] = `import { defineFormat } from '@engine';

export default defineFormat({
  id: '${name}.format',
  order: 50,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === '${elementType ?? name}'),
  Component: ({ editor, selection }) => {
    // TODO: controls that call editor.updateMany(selection.map((el) => ({ id: el.id, patch: {...} })))
    return null;
  },
});
`;
}

if (panelSlot) {
  files['panel.tsx'] = `import { definePanel } from '@engine';

export default definePanel({
  id: '${name}.panel',
  slot: '${panelSlot}',
  order: 50,
  Component: ({ editor }) => {
    return null; // TODO
  },
});
`;
}

if (flag('commands')) {
  files['commands.ts'] = `import { defineCommands } from '@engine';

export default defineCommands([
  {
    id: '${name}.example',
    label: 'TODO',
    run(editor) {
      // TODO
    },
  },
]);
`;
}

// How the feature's elements (or its collections) read in the board outline — the semantic read
// model agents, the API and AI use. Runs on the server too: pure, '@freero/shared' only [W13].
if (elementType || flag('outline')) {
  files['outline.ts'] = `// How ${name} reads in the board outline (see @freero/shared outline/define.ts).
import { defineOutline } from '@freero/shared';

export default defineOutline({${
    elementType
      ? `
  kinds: {
    // TODO: the element's text (ctx.plain(el.text) for RichText), a variant, fields; null = not content.
    '${elementType}': (el, ctx) => ({ text: '' }),
  },`
      : `
  // TODO: what this feature's collections add to items (votes, tags, comments …), by element id.
  annotate: (ctx) => ({ items: new Map() }),`
  }
});
`;
}

if (flag('decoration')) {
  files['decoration.tsx'] = `import { defineDecoration } from '@engine';

// Drawn inside another element's world wrapper: moves, rotates and exports with it.
export default defineDecoration({
  id: '${name}.decoration',
  appliesTo: (element) => false, // TODO: cheap check, e.g. element.type === 'sticky'
  Component: ({ element, zoom }) => {
    return null; // TODO: absolutely positioned inside element.w × element.h
  },
});
`;
}

if (flag('importer')) {
  files['importer.ts'] = `import { defineImporter } from '@engine';

// Pasted / dropped data no single element type owns (a whole file of another tool). Same order and
// contract as ElementDefinition.importData: return true (or the files you took) to claim it.
export default defineImporter({
  id: '${name}',
  importPriority: 50,
  importData(editor, data, at) {
    return false; // TODO
  },
});
`;
}

fs.mkdirSync(dir, { recursive: true });
for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), content);
console.log(`Created features/${name}/: ${Object.keys(files).join(', ')}`);
console.log('It is discovered automatically — no registry to edit. Run `npm run check` when done.');
