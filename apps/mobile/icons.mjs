#!/usr/bin/env node
// Paints Freero's own icon and launch screen over every picture in the native projects (#177):
// `cap add` brings Capacitor's template artwork, which isn't ours to ship. Each PNG keeps its size;
// launcher icons and the App Store icon get the Freero mark on its purple (full bleed: the
// systems round or mask it), launch screens the mark small on the brand background. Rendered with
// resvg (MPL-2.0, already the server's) from apps/web/public/icons/freero-maskable.svg's drawing.
//
//   node apps/mobile/icons.mjs        (run by build.mjs after `cap add`; safe to run again)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { initWasm, Resvg } = require('@resvg/resvg-wasm');
await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

const MARK = '<path d="M21 46V18h22v6H28v6h12v6H28v10z" fill="#fff"/><circle cx="45" cy="43" r="4" fill="#2EE6B8"/>';
/** The icon, full bleed: the mark in the central safe zone (what every launcher mask keeps). */
const icon = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#5B3FF0"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${MARK}</g></svg>`;
/** Android's adaptive foreground: only the mark, inside the 66/108 safe circle. */
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(32 32) scale(0.55) translate(-32 -32)">${MARK}</g></svg>`;
/** A launch screen of any proportions: the brand purple, the mark at a sixth of the short side. */
const splash = (w, h) => {
  const s = Math.min(w, h) / 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#5B3FF0"/><svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 64 64">${MARK}</svg></svg>`;
};

function size(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function render(svg, w, h) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: w }, background: 'rgba(0,0,0,0)' }).render().asPng();
}

function pngsUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => f.endsWith('.png'));
}

const NATIVE = path.join(HERE, 'native');
let painted = 0;
for (const file of [...pngsUnder(path.join(NATIVE, 'android/app/src/main/res')), ...pngsUnder(path.join(NATIVE, 'ios/App/App/Assets.xcassets'))]) {
  const { w, h } = size(file);
  const name = path.basename(file);
  let svg;
  if (/splash/i.test(name)) svg = splash(w, h);
  else if (/foreground/.test(name)) svg = foreground;
  else svg = icon(name.startsWith('AppIcon') ? 0.62 : 0.7);
  fs.writeFileSync(file, render(svg, w, h));
  painted++;
}
// The adaptive icon's background layer is the brand purple too.
const bg = path.join(NATIVE, 'android/app/src/main/res/values/ic_launcher_background.xml');
if (fs.existsSync(bg)) fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#5B3FF0</color>\n</resources>\n');
console.log(`Painted ${painted} pictures with Freero's icon and launch screen.`);
