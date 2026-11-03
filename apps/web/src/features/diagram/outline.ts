// How diagrams read in the board outline (#117, #118): the diagram with its title, layout and
// layers; with two or more layers its members are listed under their layer (hidden and locked
// layers marked: a hidden layer's items are folded away on the board, not gone). Members are its
// children (frameId), so shapes and the lines between them read inside it.
import { DIAGRAM_LAYOUT_NAMES, defineOutline, diagramLayers, memberLayerId } from '@freero/shared';

export default defineOutline({
  kinds: {
    diagram: (d, ctx) => {
      const layers = diagramLayers(d);
      return {
        title: ctx.plain(d.title),
        standalone: true,
        fields: {
          layout: DIAGRAM_LAYOUT_NAMES[d.layout] ?? null,
          layers: layers.length > 1 ? layers.length : null,
        },
        ...(layers.length > 1
          ? {
              // Top of the stack first, as the layers panel lists them.
              sections: [...layers].reverse().map((l) => ({ id: l.id, title: l.name, fields: { hidden: l.hidden ? true : null, locked: l.locked ? true : null } })),
              sectionOf: (child) => memberLayerId(d, child),
            }
          : {}),
      };
    },
  },
});
