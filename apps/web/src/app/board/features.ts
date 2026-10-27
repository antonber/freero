// Feature discovery root — the ONLY import.meta.glob in the web app [W6].
// Every features/<name>/ folder is picked up through its reserved files; there is no registry
// to edit when adding a feature.
import { collectFeatures } from '@engine';

const modules = import.meta.glob('../../features/*/{feature,element,tool,format,panel,commands,decoration}.{ts,tsx}', {
  eager: true,
});

export const features = collectFeatures(modules);
