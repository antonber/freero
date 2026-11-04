// Builds the ChatGPT app directory upload (platform.openai.com → Plugins → Upload): a ZIP with
// plugin.json and mcp.json at its root and the icon under assets/, from integrations/chatgpt/.
// Usage: npm run chatgpt:plugin  →  dist/freero-chatgpt-plugin.zip
// Nothing secret goes in it: reviewer credentials and the domain token are entered in the portal.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const { zipSync } = createRequire(path.join(root, 'apps/server/package.json'))('fflate');
const src = path.join(root, 'integrations/chatgpt');
const plugin = JSON.parse(fs.readFileSync(path.join(src, 'plugin.json'), 'utf8'));
const ui = plugin.extensions['com.openai'].interface;

// The portal's limits (developers.openai.com/apps-sdk/deploy/submission), checked before upload.
const problems = [];
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(plugin.name) || plugin.name.length > 64) problems.push('name: lowercase letters, digits and single hyphens, at most 64');
for (const [field, max] of [['displayName', 30], ['shortDescription', 30], ['longDescription', 4000], ['developerName', 80]])
  if (!ui[field] || ui[field].length > max) problems.push(`${field}: 1–${max} characters (has ${ui[field]?.length ?? 0})`);
for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'])
  if (!ui[field]?.startsWith('https://')) problems.push(`${field}: an https address`);
const files = { 'plugin.json': fs.readFileSync(path.join(src, 'plugin.json')), 'mcp.json': fs.readFileSync(path.join(src, 'mcp.json')) };
for (const icon of new Set([ui.logo, ui.composerIcon])) {
  const file = path.join(src, icon);
  if (!fs.existsSync(file)) problems.push(`${icon}: missing`);
  else files[icon.replace(/^\.\//, '')] = fs.readFileSync(file);
}
const servers = Object.values(JSON.parse(files['mcp.json']).mcpServers ?? {});
if (servers.length !== 1 || !servers[0].url?.startsWith('https://') || servers[0].headers) problems.push('mcp.json: exactly one https server, no headers');
if (problems.length) {
  console.error(`Not built:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const out = path.join(root, 'dist/freero-chatgpt-plugin.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(v)]))));
console.log(`${path.relative(root, out)} (${Object.keys(files).join(', ')})`);
