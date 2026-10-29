// A spec becomes the same `BuiltTemplate` a hand-coded template builds, so insert, preview,
// search, the outline and the API treat both alike.
import { Kit } from '../kit';
import type { BuiltTemplate } from '../types';
import * as A from './archetypes';
import type { Archetype, TemplateSpec } from './types';

/** Every archetype a spec may name, with its renderer. */
export const ARCHETYPES: { [K in Archetype]: (k: Kit, s: Extract<TemplateSpec, { archetype: K }>) => void } = {
  matrix: A.matrix,
  columns: A.columns,
  kanban: A.kanban,
  canvas: A.canvas,
  timeline: A.timeline,
  funnel: A.funnel,
  journey: A.journey,
  tree: A.tree,
  prompts: A.prompts,
  table: A.table,
  clusters: A.clusters,
  hub: A.hub,
  flow: A.flow,
};

export function buildSpec(spec: TemplateSpec, newId: () => string): BuiltTemplate {
  const k = new Kit(newId);
  const render = ARCHETYPES[spec.archetype] as (k: Kit, s: TemplateSpec) => void;
  if (!render) throw new Error(`Template ${spec.id}: unknown archetype "${spec.archetype}"`);
  render(k, spec);
  return k.done();
}
