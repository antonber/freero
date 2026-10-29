#!/usr/bin/env node
// npm run gen:power-automate [-- --host boards.example.com --out my-connector.json]
// Writes the Power Automate / Logic Apps custom connector (Swagger 2.0) made from docs/api/openapi.json
// (scripts/lib/swagger2.mjs). Without arguments it refreshes the checked-in example for
// freero.example.com, which a test keeps in step with openapi.json.
import fs from 'node:fs';
import path from 'node:path';
import { toSwagger2 } from './lib/swagger2.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const CONNECTOR_FILE = 'docs/integrations/power-automate/freero.swagger.json';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const host = arg('host') ?? 'freero.example.com';
if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
  console.error('--host is a host name such as boards.example.com (no https://, no path)');
  process.exit(2);
}
const out = path.resolve(ROOT, arg('out') ?? CONNECTOR_FILE);
const openapi = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/api/openapi.json'), 'utf8'));
const text = `${JSON.stringify(toSwagger2(openapi, { host }), null, 2)}\n`;
if (Buffer.byteLength(text) >= 1024 * 1024) {
  console.error('The connector is 1 MB or more, which Power Automate refuses.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
console.log(`Wrote ${path.relative(ROOT, out).split(path.sep).join('/')} for https://${host}${openapi.servers?.[0]?.url ?? ''} (${Object.keys(openapi.paths).length} paths).`);
