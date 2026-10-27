// Indexes everything features contributed. Validates single-writer and uniqueness rules at startup.
import type { ElementType } from '@freero/shared';
import type {
  CommandDefinition,
  DecorationDefinition,
  ElementDefinition,
  FeatureBundle,
  FeatureManifest,
  FormatDefinition,
  PanelDefinition,
  PanelSlot,
  ToolDefinition,
} from '../api';
import { claimCollections } from '../store/collections';

export interface Registered<T> {
  def: T;
  /** Feature name that contributed it ('engine' for built-ins). */
  feature: string;
}

export interface Registry {
  features: FeatureManifest[];
  elements: Map<ElementType, Registered<ElementDefinition<any>>>;
  tools: Registered<ToolDefinition>[];
  toolsById: Map<string, Registered<ToolDefinition>>;
  formats: Registered<FormatDefinition>[];
  panels: Map<PanelSlot, Registered<PanelDefinition>[]>;
  panelsById: Map<string, Registered<PanelDefinition>>;
  commands: Map<string, Registered<CommandDefinition>>;
  collectionOwners: Map<string, string>;
  /** Element definitions with importData, highest priority first. */
  importers: Registered<ElementDefinition<any>>[];
  /** decoration.tsx contributions, by order. */
  decorations: Registered<DecorationDefinition>[];
}

export function buildRegistry(
  bundles: FeatureBundle[],
  builtins: { tools: ToolDefinition[]; commands: CommandDefinition[] },
): Registry {
  const reg: Registry = {
    features: bundles.map((b) => b.manifest),
    elements: new Map(),
    tools: [],
    toolsById: new Map(),
    formats: [],
    panels: new Map(),
    panelsById: new Map(),
    commands: new Map(),
    collectionOwners: claimCollections(bundles.map((b) => b.manifest)),
    importers: [],
    decorations: [],
  };

  const addTool = (def: ToolDefinition, feature: string) => {
    const prev = reg.toolsById.get(def.id);
    if (prev) throw new Error(`Tool id '${def.id}' is defined by both '${prev.feature}' and '${feature}'.`);
    const r = { def, feature };
    reg.toolsById.set(def.id, r);
    reg.tools.push(r);
  };
  const addCommand = (def: CommandDefinition, feature: string) => {
    const prev = reg.commands.get(def.id);
    if (prev) throw new Error(`Command id '${def.id}' is defined by both '${prev.feature}' and '${feature}'.`);
    reg.commands.set(def.id, { def, feature });
  };

  for (const t of builtins.tools) addTool(t, 'engine');
  for (const c of builtins.commands) addCommand(c, 'engine');

  for (const b of bundles) {
    const feature = b.manifest.name;
    for (const def of b.elements) {
      const prev = reg.elements.get(def.type);
      if (prev) throw new Error(`Element type '${def.type}' is defined by both '${prev.feature}' and '${feature}'.`);
      reg.elements.set(def.type, { def, feature });
      if (def.importData) reg.importers.push({ def, feature });
    }
    for (const t of b.tools) addTool(t, feature);
    for (const f of b.formats) reg.formats.push({ def: f, feature });
    for (const p of b.panels) {
      if (reg.panelsById.has(p.id)) throw new Error(`Panel id '${p.id}' is defined twice.`);
      const r = { def: p, feature };
      reg.panelsById.set(p.id, r);
      const list = reg.panels.get(p.slot) ?? [];
      list.push(r);
      reg.panels.set(p.slot, list);
    }
    for (const c of b.commands) addCommand(c, feature);
    for (const d of b.decorations ?? []) {
      if (reg.decorations.some((r) => r.def.id === d.id)) throw new Error(`Decoration id '${d.id}' is defined twice.`);
      reg.decorations.push({ def: d, feature });
    }
  }

  reg.tools.sort((a, b) => a.def.order - b.def.order);
  reg.formats.sort((a, b) => a.def.order - b.def.order);
  for (const list of reg.panels.values()) list.sort((a, b) => a.def.order - b.def.order);
  reg.decorations.sort((a, b) => (a.def.order ?? 0) - (b.def.order ?? 0));
  reg.importers.sort((a, b) => (b.def.importPriority ?? 0) - (a.def.importPriority ?? 0));
  return reg;
}
