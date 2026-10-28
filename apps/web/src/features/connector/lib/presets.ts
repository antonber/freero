// Line ends grouped for the format toolbar, and diagram line presets: each preset is only a
// combination of existing styles (routing, dash, ends), so it needs nothing new in the model.
import type { CapStyle } from '@freero/shared';
import type { ConnectorStyle } from './model';

export interface CapGroup {
  heading: string | null;
  caps: Array<{ value: CapStyle; label: string }>;
}

export const CAP_GROUPS: CapGroup[] = [
  {
    heading: null,
    caps: [
      { value: 'none', label: 'None' },
      { value: 'arrow', label: 'Arrow' },
      { value: 'triangle', label: 'Triangle' },
      { value: 'circle', label: 'Circle' },
      { value: 'diamond', label: 'Diamond' },
      { value: 'bar', label: 'Bar' },
    ],
  },
  {
    heading: 'Hollow',
    caps: [
      { value: 'triangleOpen', label: 'Hollow triangle' },
      { value: 'diamondOpen', label: 'Hollow diamond' },
      { value: 'circleOpen', label: 'Hollow circle' },
    ],
  },
  {
    heading: 'Cardinality',
    caps: [
      { value: 'one', label: 'Exactly one' },
      { value: 'zeroOrOne', label: 'Zero or one' },
      { value: 'many', label: 'Many' },
      { value: 'oneOrMany', label: 'One or many' },
      { value: 'zeroOrMany', label: 'Zero or many' },
    ],
  },
];

export type LinePreset = { id: string; label: string; style: Partial<ConnectorStyle> };

export const PRESET_GROUPS: Array<{ heading: string; presets: LinePreset[] }> = [
  {
    heading: 'Sequence (UML)',
    presets: [
      { id: 'sync', label: 'Call', style: { routing: 'straight', strokeStyle: 'solid', startCap: 'none', endCap: 'triangle' } },
      { id: 'async', label: 'Asynchronous call', style: { routing: 'straight', strokeStyle: 'solid', startCap: 'none', endCap: 'arrow' } },
      { id: 'return', label: 'Reply', style: { routing: 'straight', strokeStyle: 'dashed', startCap: 'none', endCap: 'arrow' } },
    ],
  },
  {
    heading: 'Class (UML)',
    presets: [
      { id: 'inherit', label: 'Generalisation', style: { strokeStyle: 'solid', startCap: 'none', endCap: 'triangleOpen' } },
      { id: 'realize', label: 'Realisation', style: { strokeStyle: 'dashed', startCap: 'none', endCap: 'triangleOpen' } },
      { id: 'compose', label: 'Composition', style: { strokeStyle: 'solid', startCap: 'diamond', endCap: 'none' } },
      { id: 'aggregate', label: 'Aggregation', style: { strokeStyle: 'solid', startCap: 'diamondOpen', endCap: 'none' } },
      { id: 'depend', label: 'Dependency', style: { strokeStyle: 'dashed', startCap: 'none', endCap: 'arrow' } },
    ],
  },
  {
    heading: 'BPMN',
    presets: [
      { id: 'flow', label: 'Sequence flow', style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'none', endCap: 'triangle' } },
      { id: 'message', label: 'Message flow', style: { strokeStyle: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' } },
      { id: 'data', label: 'Data association', style: { strokeStyle: 'dotted', startCap: 'none', endCap: 'arrow' } },
    ],
  },
  {
    heading: 'Entity relationship',
    presets: [
      { id: 'one-many', label: 'One to many', style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'one', endCap: 'zeroOrMany' } },
      { id: 'one-one', label: 'One to one', style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'one', endCap: 'zeroOrOne' } },
      { id: 'many-many', label: 'Many to many', style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'oneOrMany', endCap: 'zeroOrMany' } },
    ],
  },
];
