#!/usr/bin/env node
// Builds the Freero plugin for Figma (#172) into integrations/figma/dist/ and writes manifest.json —
// no dependencies, no bundler: Figma takes one JavaScript file for the sandbox and one HTML page
// (scripts inlined) for the plugin's window.
//
//   node integrations/figma/build.mjs [--server https://freero.app] [--id <Figma plugin id>]
//
// --server: the Freero the plugin offers by default and may reach (manifest `networkAccess`); a
//           self-hosted operator builds their own copy for their address. localhost is allowed
//           while developing (Figma's devAllowedDomains).
// --id:     the id Figma gives the plugin when you first publish it (kept in manifest.json after).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const manifestPath = path.join(HERE, 'manifest.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const server = new URL(opt('server') ?? process.env.FREERO_URL ?? previous.networkAccess?.allowedDomains?.[0] ?? 'https://freero.app').origin;
if (!server.startsWith('https://')) throw new Error('--server must be an https address (localhost is always allowed for development)');

const read = (f) => fs.readFileSync(path.join(HERE, 'src', f), 'utf8');
// freero.js is an ES module (the server's tests import it); inlined, its exports are plain declarations.
const client = read('freero.js').replace(/^export (?=(async )?(function|class|const|let) )/gm, '');
if (/^\s*(import|export)\b/m.test(client)) throw new Error('src/freero.js may not import or re-export: it is inlined into the plugin page');
const ui = read('ui.html').replace('/*FREERO_JS*/', () => client).replace('/*UI_JS*/', () => read('ui.js'));
const code = read('code.js').replace('__FREERO_URL__', server);

fs.mkdirSync(path.join(HERE, 'dist'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'dist/ui.html'), ui);
fs.writeFileSync(path.join(HERE, 'dist/code.js'), code);

const manifest = {
  name: 'Freero',
  id: opt('id') ?? previous.id ?? 'set-by-figma-on-first-publish',
  api: '1.0.0',
  main: 'dist/code.js',
  ui: 'dist/ui.html',
  editorType: ['figma'],
  documentAccess: 'dynamic-page',
  networkAccess: {
    allowedDomains: [server],
    devAllowedDomains: ['http://localhost:4000', 'http://localhost:5173'],
    reasoning: 'The plugin sends the frames you choose to your Freero board through Freero’s REST API, at the Freero address you sign in to.',
  },
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built the Figma plugin for ${server}: integrations/figma/manifest.json + dist/ (import manifest.json in Figma → Plugins → Development).`);
