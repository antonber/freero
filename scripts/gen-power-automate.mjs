#!/usr/bin/env node
// Power Automate / Logic Apps connectors made from docs/api/openapi.json (scripts/lib/powerAutomate.mjs):
//
//   npm run gen:power-automate                       refresh the checked-in files: the custom connector
//                                                    for freero.example.com and the certification files
//                                                    for freero.app (a test keeps them in step)
//   npm run gen:power-automate -- --host boards.example.com [--out my-connector.json]
//                                                    the custom connector for your instance
//   npm run gen:power-automate -- --certified --client-id <id> [--out-dir <folder>]
//                                                    the certification files with the hosted Freero's
//                                                    OAuth app id, to submit (docs/integrations/power-automate.md)
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_TYPES } from '../packages/shared/src/events.ts';
import { BRAND_COLOR, colorIcon } from '../apps/server/src/platform/brandIcons.ts';
import { CERTIFIED_CLIENT_ID_PLACEHOLDER, CERTIFIED_DIR, certifiedFiles, CONNECTOR_FILE, customConnector } from './lib/powerAutomate.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const certifiedOnly = process.argv.includes('--certified');
const openapi = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/api/openapi.json'), 'utf8'));
const events = Object.keys(EVENT_TYPES);
const write = (rel, data) => {
  const out = path.resolve(ROOT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
  return path.relative(ROOT, out).split(path.sep).join('/');
};

if (!certifiedOnly) {
  const host = arg('host') ?? 'freero.example.com';
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    console.error('--host is a host name such as boards.example.com (no https://, no path)');
    process.exit(2);
  }
  const text = `${JSON.stringify(customConnector(openapi, { host, events }), null, 2)}\n`;
  if (Buffer.byteLength(text) >= 1024 * 1024) {
    console.error('The connector is 1 MB or more, which Power Automate refuses.');
    process.exit(1);
  }
  const file = write(arg('out') ?? CONNECTOR_FILE, text);
  console.log(`Wrote ${file} for https://${host}${openapi.servers?.[0]?.url ?? ''} (${Object.keys(openapi.paths).length} paths).`);
}

if (certifiedOnly || !arg('host')) {
  const clientId = arg('client-id') ?? CERTIFIED_CLIENT_ID_PLACEHOLDER;
  const dir = arg('out-dir') ?? CERTIFIED_DIR;
  const files = certifiedFiles(openapi, { events, clientId, brandColor: BRAND_COLOR });
  for (const [name, data] of Object.entries(files)) write(path.join(dir, name), data);
  write(path.join(dir, 'icon.png'), colorIcon(230));
  const placeholder = clientId === CERTIFIED_CLIENT_ID_PLACEHOLDER ? ' (give --client-id <the OAuth app id> before submitting)' : '';
  console.log(`Wrote ${[...Object.keys(files), 'icon.png'].map((f) => `${dir}/${f}`).join(', ')}${placeholder}.`);
}
