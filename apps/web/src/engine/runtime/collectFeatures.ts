// Turns the eager `import.meta.glob` result of features/*/{reserved files} into FeatureBundles.
// The glob itself lives in app/board/features.ts (the only allowed glob [W6]).
import type {
  CommandDefinition,
  CommandFactory,
  DecorationDefinition,
  ElementDefinition,
  FeatureBundle,
  FeatureManifest,
  FormatDefinition,
  ImporterDefinition,
  PanelDefinition,
  ToolDefinition,
} from '../api';
import type { OutlineFeature } from '@freero/shared';

const FILE_RE = /features\/([^/]+)\/(feature|element|tool|format|panel|commands|decoration|outline|importer)\.tsx?$/;

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function collectFeatures(modules: Record<string, unknown>): FeatureBundle[] {
  const byName = new Map<string, Partial<FeatureBundle> & { files: string[] }>();
  for (const [path, mod] of Object.entries(modules)) {
    const m = path.replace(/\\/g, '/').match(FILE_RE);
    if (!m) continue;
    const [, name, kind] = m;
    const entry = byName.get(name) ?? { files: [], elements: [], tools: [], formats: [], panels: [], commands: [], commandFactories: [], decorations: [], importers: [] };
    byName.set(name, entry);
    entry.files.push(path);
    const value = (mod as { default?: unknown })?.default;
    switch (kind) {
      case 'feature':
        entry.manifest = value as FeatureManifest;
        break;
      case 'element':
        entry.elements!.push(...asArray(value as ElementDefinition<any> | ElementDefinition<any>[]));
        break;
      case 'tool':
        entry.tools!.push(...asArray(value as ToolDefinition | ToolDefinition[]));
        break;
      case 'format':
        entry.formats!.push(...asArray(value as FormatDefinition | FormatDefinition[]));
        break;
      case 'panel':
        entry.panels!.push(...asArray(value as PanelDefinition | PanelDefinition[]));
        break;
      case 'commands':
        // A factory (`defineCommands(ctx => [...])`) runs once the registry knows every element.
        if (typeof value === 'function') entry.commandFactories!.push(value as CommandFactory);
        else entry.commands!.push(...asArray(value as CommandDefinition[]).flat());
        break;
      case 'decoration':
        entry.decorations!.push(...asArray(value as DecorationDefinition | DecorationDefinition[]));
        break;
      case 'outline':
        entry.outline = value as OutlineFeature;
        break;
      case 'importer':
        entry.importers!.push(...asArray(value as ImporterDefinition | ImporterDefinition[]));
        break;
    }
  }
  const bundles: FeatureBundle[] = [];
  for (const [name, e] of byName) {
    if (!e.manifest) throw new Error(`features/${name} has no feature.ts manifest (export default defineFeature({...})).`);
    if (e.manifest.name !== name)
      throw new Error(`features/${name}/feature.ts declares name '${e.manifest.name}'; it must equal the folder name.`);
    bundles.push({
      manifest: e.manifest,
      elements: e.elements!,
      tools: e.tools!,
      formats: e.formats!,
      panels: e.panels!,
      commands: e.commands!,
      commandFactories: e.commandFactories!,
      decorations: e.decorations!,
      importers: e.importers!,
      ...(e.outline ? { outline: e.outline } : {}),
    });
  }
  bundles.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return bundles;
}
