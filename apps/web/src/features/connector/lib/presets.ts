// Line ends grouped for the format toolbar, and diagram line presets: each preset is only a
// combination of existing styles (routing, dash, ends), so it needs nothing new in the model.
import type { CapStyle } from '@freero/shared';
import type { ConnectorStyle } from './model';

import { t } from '../messages';
export interface CapGroup {
  heading: string | null;
  caps: Array<{ value: CapStyle; label: string }>;
}

export const CAP_GROUPS: CapGroup[] = [
  {
    heading: null,
    caps: [
      { value: 'none', label: t('none') },
      { value: 'arrow', label: 'Arrow' },
      { value: 'triangle', label: t('triangle') },
      { value: 'circle', label: t('circle') },
      { value: 'diamond', label: t('diamond') },
      { value: 'bar', label: t('bar') },
    ],
  },
  {
    heading: t('hollow'),
    caps: [
      { value: 'triangleOpen', label: t('hollowTriangle') },
      { value: 'diamondOpen', label: t('hollowDiamond') },
      { value: 'circleOpen', label: t('hollowCircle') },
    ],
  },
  {
    heading: t('cardinality'),
    caps: [
      { value: 'one', label: t('exactlyOne') },
      { value: 'zeroOrOne', label: t('zeroOrOne') },
      { value: 'many', label: t('many') },
      { value: 'oneOrMany', label: t('oneOrMany') },
      { value: 'zeroOrMany', label: t('zeroOrMany') },
    ],
  },
];

export type LinePreset = { id: string; label: string; style: Partial<ConnectorStyle> };

export const PRESET_GROUPS: Array<{ heading: string; presets: LinePreset[] }> = [
  {
    heading: t('sequenceUml'),
    presets: [
      { id: 'sync', label: t('call'), style: { routing: 'straight', strokeStyle: 'solid', startCap: 'none', endCap: 'triangle' } },
      { id: 'async', label: t('asynchronousCall'), style: { routing: 'straight', strokeStyle: 'solid', startCap: 'none', endCap: 'arrow' } },
      { id: 'return', label: t('reply'), style: { routing: 'straight', strokeStyle: 'dashed', startCap: 'none', endCap: 'arrow' } },
    ],
  },
  {
    heading: t('classUml'),
    presets: [
      { id: 'inherit', label: t('generalisation'), style: { strokeStyle: 'solid', startCap: 'none', endCap: 'triangleOpen' } },
      { id: 'realize', label: t('realisation'), style: { strokeStyle: 'dashed', startCap: 'none', endCap: 'triangleOpen' } },
      { id: 'compose', label: t('composition'), style: { strokeStyle: 'solid', startCap: 'diamond', endCap: 'none' } },
      { id: 'aggregate', label: t('aggregation'), style: { strokeStyle: 'solid', startCap: 'diamondOpen', endCap: 'none' } },
      { id: 'depend', label: t('dependency'), style: { strokeStyle: 'dashed', startCap: 'none', endCap: 'arrow' } },
    ],
  },
  {
    heading: 'BPMN',
    presets: [
      { id: 'flow', label: t('sequenceFlow'), style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'none', endCap: 'triangle' } },
      { id: 'message', label: t('messageFlow'), style: { strokeStyle: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' } },
      { id: 'data', label: t('dataAssociation'), style: { strokeStyle: 'dotted', startCap: 'none', endCap: 'arrow' } },
    ],
  },
  {
    heading: t('entityRelationship'),
    presets: [
      { id: 'one-many', label: t('oneToMany'), style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'one', endCap: 'zeroOrMany' } },
      { id: 'one-one', label: t('oneToOne'), style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'one', endCap: 'zeroOrOne' } },
      { id: 'many-many', label: t('manyToMany'), style: { routing: 'elbow', strokeStyle: 'solid', startCap: 'oneOrMany', endCap: 'zeroOrMany' } },
    ],
  },
];
