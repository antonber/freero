import { describe, expect, it } from 'vitest';
import { exportFileName } from './lib/files';
import { buildFramesPdf, type PdfFrame } from './lib/pdf';

// A real 1×1 PNG, so jsPDF decodes an actual image for every page.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const frame = (id: string, index: number, w: number, h: number): PdfFrame => ({ id, title: id, index, x: 0, y: 0, w, h });

function pageSizes(pdf: NonNullable<Awaited<ReturnType<typeof buildFramesPdf>>>) {
  return Array.from({ length: pdf.getNumberOfPages() }, (_, i) => {
    const box = pdf.getPageInfo(i + 1).pageContext.mediaBox;
    return { w: Math.round(box.topRightX - box.bottomLeftX), h: Math.round(box.topRightY - box.bottomLeftY) };
  });
}

describe('Export frames as PDF', () => {
  // Board order is creation order; the PDF must follow the frames' presentation index instead.
  const frames = [frame('c', 2, 800, 400), frame('a', 0, 400, 400), frame('b', 1, 400, 800)];

  it('creates one page per frame, in index order, each page shaped like its frame', async () => {
    const rendered: string[] = [];
    const pdf = await buildFramesPdf(frames, {
      pageSize: 'fit',
      render: async (f) => {
        rendered.push(f.id);
        return PNG;
      },
    });
    expect(rendered).toEqual(['a', 'b', 'c']);
    // 0.75 pt per px: a = 400×400, b = 400×800 (portrait), c = 800×400 (landscape)
    expect(pageSizes(pdf!)).toEqual([
      { w: 300, h: 300 },
      { w: 300, h: 600 },
      { w: 600, h: 300 },
    ]);
  });

  it('uses A4 landscape for every page when asked, whatever the frame shape', async () => {
    const pdf = await buildFramesPdf(frames, { pageSize: 'a4', render: async () => PNG });
    expect(pageSizes(pdf!)).toEqual(Array(3).fill({ w: 842, h: 595 }));
  });

  it('stops rendering further pages once cancelled', async () => {
    const ctrl = new AbortController();
    let renders = 0;
    const pdf = await buildFramesPdf(frames, {
      pageSize: 'fit',
      signal: ctrl.signal,
      render: async () => {
        if (++renders === 1) ctrl.abort();
        return PNG;
      },
    });
    expect(pdf).toBeNull();
    expect(renders).toBe(1);
  });
});

describe('export file names from the board title', () => {
  it('never contain characters Windows or macOS reject in a file name', () => {
    const name = exportFileName('Q3/Q4: "launch" plan? <draft> | v2*', 'png');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.endsWith('.png')).toBe(true);
    expect(name).toContain('Q3');
  });

  it('fall back to a readable name when the title is empty, dots only or a reserved device name', () => {
    for (const title of ['', '   ', '...', 'CON', 'nul']) expect(exportFileName(title, 'pdf')).toBe('Freero board.pdf');
  });
});
