// A drop of several kinds of files is split among the importers (KAI-204): each takes its kind,
// the rest flows on, and what lands beside the first group never covers it, even while the first
// group is still uploading.
import { expect, it } from 'vitest';
import type { ElementDefinition, ImportData, ImporterDefinition, Rect } from '../api';
import { elementAABB } from '../geometry/geometry';
import { boxDef, bundle, makeCore } from './harness';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

it('dropping a photo, a video and a zip together places every file, the later kinds beside the photo still uploading', async () => {
  const offered: Array<{ importer: string; files: string[]; alongside: boolean; text: string | null }> = [];
  let finishPhotoUpload = () => {};
  let photoArea: Rect | null = null;

  // Like images: takes only its kind, lands centered on the drop point, uploads before creating.
  const pictures: ElementDefinition<'sticky'> = {
    ...boxDef,
    importPriority: 100,
    importData(editor, data: ImportData, at) {
      offered.push({ importer: 'pictures', files: data.files.map((f) => f.name), alongside: !!data.alongside, text: data.text });
      const mine = data.files.filter((f) => f.type.startsWith('image/'));
      if (!mine.length) return false;
      const area = { x: at.x - 200, y: at.y - 150, w: 400, h: 300 };
      photoArea = area;
      const release = editor.reserveSpace([area]);
      void new Promise<void>((done) => (finishPhotoUpload = done)).then(() => {
        release();
        editor.create({ ...boxDef.defaults!(), ...area } as never);
      });
      return mine;
    },
  };
  // Like media: everything left, as one row in a free spot near the drop when alongside.
  const everythingElse: ElementDefinition<'sticky'> = {
    ...boxDef,
    type: 'card' as never,
    importPriority: 12,
    importData(editor, data: ImportData, at) {
      offered.push({ importer: 'rest', files: data.files.map((f) => f.name), alongside: !!data.alongside, text: data.text });
      if (!data.files.length) return false;
      const size = { w: 200 * data.files.length, h: 100 };
      const spot = data.alongside ? editor.findFreeSpot(size, { near: at }) : { x: at.x - size.w / 2, y: at.y - size.h / 2 };
      data.files.forEach((_, i) => editor.create({ ...boxDef.defaults!(), x: spot.x + i * 200, y: spot.y, w: 200, h: 100 } as never));
      return data.files;
    },
  };
  const core = makeCore({ bundles: [bundle('pictures', { elements: [pictures as ElementDefinition<any>] }), bundle('rest', { elements: [everythingElse as ElementDefinition<any>] })] });

  const files = [new File(['p'], 'photo.png', { type: 'image/png' }), new File(['v'], 'talk.mp4', { type: 'video/mp4' }), new File(['z'], 'brief.zip', { type: 'application/zip' })];
  const at = core.editor.getViewportCenter();
  expect(await core.editor.importData({ files, text: 'photo.png', html: null }, at)).toBe(true);

  expect(offered).toEqual([
    { importer: 'pictures', files: ['photo.png', 'talk.mp4', 'brief.zip'], alongside: false, text: 'photo.png' },
    { importer: 'rest', files: ['talk.mp4', 'brief.zip'], alongside: true, text: null },
  ]);
  // The video and the zip landed before the photo finished uploading, and not where it will go.
  const others = core.editor.getElements();
  expect(others).toHaveLength(2);
  for (const el of others) expect(overlaps(elementAABB(el), photoArea!)).toBe(false);

  finishPhotoUpload();
  await Promise.resolve();
  expect(core.editor.getElements()).toHaveLength(3);
});

it('an importer.ts takes the files it knows before a lower-priority element type that takes any file, and the rest still flows on (KAI-138)', async () => {
  const took: string[] = [];
  const anyFile: ElementDefinition<'sticky'> = {
    ...boxDef,
    importPriority: 12,
    importData(_editor, data: ImportData) {
      took.push(...data.files.map((f) => `card:${f.name}`));
      return data.files;
    },
  };
  const diagrams: ImporterDefinition = {
    id: 'diagrams',
    importPriority: 60,
    importData(_editor, data: ImportData) {
      const mine = data.files.filter((f) => f.name.endsWith('.drawio'));
      took.push(...mine.map((f) => `diagram:${f.name}`));
      return mine;
    },
  };
  const core = makeCore({ bundles: [bundle('media', { elements: [anyFile as ElementDefinition<any>] }), bundle('import', { importers: [diagrams] })] });
  const files = [new File(['<mxfile/>'], 'flow.drawio'), new File(['z'], 'brief.zip')];
  expect(await core.editor.importData({ files, text: null, html: null }, { x: 0, y: 0 })).toBe(true);
  expect(took).toEqual(['diagram:flow.drawio', 'card:brief.zip']);
});
