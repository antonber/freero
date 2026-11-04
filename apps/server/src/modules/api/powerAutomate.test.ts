// The Power Automate connectors (#88, #175, docs/integrations/power-automate.md) are generated from
// docs/api/openapi.json by `npm run gen:power-automate`. Power Automate imports only Swagger 2.0 under
// 1 MB (learn.microsoft.com/connectors/custom-connectors/define-openapi-definition), so: the checked-in
// files are what the generator makes from today's openapi.json, they hold no OpenAPI 3 construct a
// 2.0 importer would refuse or misread, and the certification files meet Microsoft's submission rules
// (learn.microsoft.com/connectors/custom-connectors/certification-submission).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { EVENT_TYPES } from '@freero/shared';
import { BRAND_COLOR } from '../../platform/brandIcons';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

type Json = Record<string, any>;
const V2_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'file']);
const OAS3_ONLY = new Set(['openapi', 'components', 'requestBody', 'content', 'servers', 'oneOf', 'anyOf', 'not', 'const', 'nullable', 'callbacks', 'links', 'examples', 'webhooks']);

/** What a Swagger 2.0 importer would refuse in `doc`, as readable problems. */
function swagger2Problems(doc: Json): string[] {
  const out: string[] = [];
  if (doc.swagger !== '2.0') out.push('swagger must be "2.0"');
  if (!doc.host || !doc.basePath?.startsWith('/') || !Array.isArray(doc.schemes)) out.push('host, basePath and schemes are required');
  const refs = new Set<string>();
  // A schema: its keywords (property NAMES under `properties` are not keywords).
  const schema = (s: Json, at: string) => {
    if (!s || typeof s !== 'object') return;
    if (s.$ref) {
      refs.add(s.$ref);
      if (Object.keys(s).length > 1) out.push(`${at}: $ref with siblings`);
      return;
    }
    for (const [k, v] of Object.entries(s)) {
      if (OAS3_ONLY.has(k)) out.push(`${at}: ${k} is not Swagger 2.0`);
      if (k === 'type' && !(typeof v === 'string' && V2_TYPES.has(v))) out.push(`${at}: type ${JSON.stringify(v)}`);
      if (k === 'properties') for (const [n, p] of Object.entries(v as Json)) schema(p as Json, `${at}.${n}`);
      if (k === 'items' || k === 'additionalProperties') schema(v as Json, `${at}.${k}`);
      if (k === 'allOf') (v as Json[]).forEach((x, i) => schema(x, `${at}.allOf[${i}]`));
    }
  };
  const param = (p: Json, at: string) => {
    if (p.$ref) return void refs.add(p.$ref);
    if (!['query', 'header', 'path', 'formData', 'body'].includes(p.in)) out.push(`${at}: in ${p.in}`);
    if (p.in === 'body') schema(p.schema, `${at}.schema`);
    else {
      if (p.schema) out.push(`${at}: only a body parameter has a schema`);
      if (!V2_TYPES.has(p.type) || p.type === 'object') out.push(`${at}: type ${p.type}`);
    }
    if (p.in === 'path' && p.required !== true) out.push(`${at}: a path parameter must be required`);
  };
  const response = (r: Json, at: string) => {
    if (r.$ref) return void refs.add(r.$ref);
    if (typeof r.description !== 'string') out.push(`${at}: description is required`);
    for (const k of Object.keys(r)) if (!['description', 'schema', 'headers', 'examples'].includes(k)) out.push(`${at}: ${k}`);
    if (r.schema) schema(r.schema, `${at}.schema`);
  };
  const ids = new Set<string>();
  for (const [p, item] of Object.entries(doc.paths as Json)) {
    const named = new Set<string>();
    const declare = (x: Json) => {
      const real = x.$ref ? doc.parameters?.[x.$ref.split('/').pop()] : x;
      if (real?.in === 'path') named.add(real.name);
    };
    (item.parameters ?? []).forEach((x: Json, i: number) => (param(x, `${p}.parameters[${i}]`), declare(x)));
    for (const [m, op] of Object.entries(item as Json)) {
      if (m === 'parameters' || m.startsWith('x-')) continue; // x-…: Swagger 2.0 extensions (x-ms-notification-content)
      const at = `${m.toUpperCase()} ${p}`;
      if (!op.operationId || ids.has(op.operationId)) out.push(`${at}: operationId missing or not unique`);
      ids.add(op.operationId);
      if (!op.summary) out.push(`${at}: Power Automate shows the summary as the action's name`);
      const own = new Set(named);
      (op.parameters ?? []).forEach((x: Json, i: number) => {
        param(x, `${at}.parameters[${i}]`);
        const real = x.$ref ? doc.parameters?.[x.$ref.split('/').pop()] : x;
        if (real?.in === 'path') own.add(real.name);
      });
      if ((op.parameters ?? []).filter((x: Json) => x.in === 'body').length > 1) out.push(`${at}: more than one body`);
      for (const t of p.match(/\{([^}]+)\}/g) ?? []) if (!own.has(t.slice(1, -1))) out.push(`${at}: path parameter ${t} not declared`);
      for (const [code, r] of Object.entries(op.responses as Json)) response(r as Json, `${at} ${code}`);
    }
  }
  for (const [k, s] of Object.entries((doc.definitions ?? {}) as Json)) schema(s as Json, `definitions.${k}`);
  for (const [k, x] of Object.entries((doc.parameters ?? {}) as Json)) param(x as Json, `parameters.${k}`);
  for (const [k, r] of Object.entries((doc.responses ?? {}) as Json)) response(r as Json, `responses.${k}`);
  for (const r of refs) {
    const m = /^#\/(definitions|parameters|responses)\/(.+)$/.exec(r);
    if (!m || !doc[m[1]]?.[m[2]]) out.push(`unresolved $ref ${r}`);
  }
  return out;
}

const lib = async () =>
  (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/powerAutomate.mjs')).href)) as {
    customConnector: (o: Json, opts: { host: string; events: string[] }) => Json;
    certifiedFiles: (o: Json, opts: { events: string[]; clientId: string; brandColor: string }) => Record<string, string>;
    CERTIFIED_DIR: string;
    CERTIFIED_CLIENT_ID_PLACEHOLDER: string;
  };
const events = Object.keys(EVENT_TYPES);

/** The webhook trigger as Power Automate needs it: its callback URL filled in by Power Automate, and the events it sends described. */
function triggerProblems(doc: Json): string[] {
  const out: string[] = [];
  const triggers = Object.entries(doc.paths as Json).flatMap(([p, item]) => Object.values(item as Json).filter((op) => (op as Json)?.['x-ms-trigger']).map((op) => [p, op as Json] as const));
  if (triggers.length !== 1) return [`expected one trigger, found ${triggers.length}`];
  const [p, op] = triggers[0];
  if (op['x-ms-trigger'] !== 'single') out.push('x-ms-trigger must be single');
  if (!doc.paths[p]['x-ms-notification-content']?.schema) out.push('the trigger path must describe what it sends (x-ms-notification-content)');
  const body = (op.parameters as Json[]).find((x) => x.in === 'body');
  const url = Object.entries((body?.schema?.properties ?? {}) as Json).find(([, s]) => (s as Json)['x-ms-notification-url'] === true);
  if (!url || url[0] !== 'url' || (url[1] as Json)['x-ms-visibility'] !== 'internal') out.push('the webhook url must be the hidden x-ms-notification-url');
  if (!op.responses['201']) out.push('Freero answers 201 (with the Location Power Automate deletes)');
  return out;
}

/** What Microsoft's certification refuses (its published rules), as readable problems. */
function certificationProblems(def: Json, props: Json): string[] {
  const out: string[] = [];
  const SUMMARY = /^[A-Za-z0-9 ()]{1,80}$/;
  const SENTENCE = /\S.*[.!?]$/s;
  if (def.info.title.length > 30 || /\b(API|Connector|Power Apps|Power Automate|Copilot Studio)\b/i.test(def.info.title)) out.push('title: 30 characters, no API / Connector / product names');
  if (def.info.description.length <= 30 || def.info.description.length >= 500) out.push('description: 30 to 500 characters');
  for (const [p, item] of Object.entries(def.paths as Json))
    for (const [m, op] of Object.entries(item as Json)) {
      if (m.startsWith('x-')) continue;
      const at = `${m.toUpperCase()} ${p}`;
      if (!SUMMARY.test(op.summary ?? '')) out.push(`${at}: summary ${JSON.stringify(op.summary)}`);
      if (!SENTENCE.test(op.description ?? '')) out.push(`${at}: description must be a sentence`);
      if (!['important', 'advanced', 'internal', 'none'].includes(op['x-ms-visibility'])) out.push(`${at}: visibility`);
      for (const [code, r] of Object.entries(op.responses as Json)) {
        if (!/^2\d\d$/.test(code)) out.push(`${at}: response ${code} (only what the operation answers when it works)`);
        else if (!(r as Json).schema && code !== '204') out.push(`${at}: ${code} has no schema`);
      }
      for (const x of op.parameters as Json[]) {
        if (!SUMMARY.test(x['x-ms-summary'] ?? '')) out.push(`${at}: parameter ${x.name} summary ${JSON.stringify(x['x-ms-summary'])}`);
        if (!SENTENCE.test(x.description ?? '')) out.push(`${at}: parameter ${x.name} description`);
      }
    }
  const auth = Object.values(def.securityDefinitions) as Json[];
  if (auth.length !== 1 || auth[0].type !== 'oauth2' || auth[0].flow !== 'accessCode') out.push('OAuth 2.0 authorization code');
  const token = props.properties.connectionParameters.token;
  if (token.type !== 'oauthSetting' || token.oAuthSettings.identityProvider !== 'oauth2') out.push('connection: generic OAuth 2.0');
  const icon = String(props.properties.iconBrandColor).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(icon) || icon === '#ffffff' || icon === '#007ee5') out.push('iconBrandColor: a brand colour, not white or the default');
  for (const m of ['Website', 'Privacy policy', 'Categories']) if (!(def['x-ms-connector-metadata'] as Json[]).some((x) => x.propertyName === m && x.propertyValue)) out.push(`x-ms-connector-metadata: ${m}`);
  return out;
}

it('the Power Automate connector is what npm run gen:power-automate makes from today’s openapi.json, valid Swagger 2.0 under 1 MB with every operation but the operators’ own and a webhook trigger', async () => {
  const { customConnector } = await lib();
  const openapi = JSON.parse(read('docs/api/openapi.json'));
  const text = read('docs/integrations/power-automate/freero.swagger.json');
  const shipped = JSON.parse(text);
  expect(shipped, 'docs/integrations/power-automate/freero.swagger.json is out of date: run npm run gen:power-automate').toEqual(customConnector(openapi, { host: 'freero.example.com', events }));
  expect(swagger2Problems(shipped)).toEqual([]);
  expect(triggerProblems(shipped)).toEqual([]);
  const auth = Object.values(shipped.securityDefinitions) as Json[];
  expect(auth.map((a) => `${a.type} ${a.in} ${a.name}`), 'one API key in the Authorization header').toEqual(['apiKey header Authorization']);
  expect(Buffer.byteLength(text)).toBeLessThan(1024 * 1024);
  const operations = (doc: Json) =>
    Object.entries(doc.paths as Json)
      .flatMap(([p, item]) =>
        Object.entries(item as Json)
          .filter(([m, op]) => m !== 'parameters' && !m.startsWith('x-') && !((op as Json).tags as string[] | undefined)?.includes('operator'))
          .map(([m, op]) => `${m} ${p} ${(op as Json).operationId}`),
      )
      .sort();
  expect(operations(shipped)).toEqual(operations(openapi));
});

it('the certification files are what the generator makes, and meet Microsoft’s rules for certified connectors', async () => {
  const { certifiedFiles, CERTIFIED_DIR, CERTIFIED_CLIENT_ID_PLACEHOLDER } = await lib();
  const files = certifiedFiles(JSON.parse(read('docs/api/openapi.json')), { events, clientId: CERTIFIED_CLIENT_ID_PLACEHOLDER, brandColor: BRAND_COLOR });
  for (const [name, text] of Object.entries(files)) expect(read(`${CERTIFIED_DIR}/${name}`), `${CERTIFIED_DIR}/${name} is out of date: run npm run gen:power-automate`).toBe(text);
  const def = JSON.parse(files['apiDefinition.swagger.json']);
  expect(swagger2Problems(def)).toEqual([]);
  expect(triggerProblems(def)).toEqual([]);
  expect(certificationProblems(def, JSON.parse(files['apiProperties.json']))).toEqual([]);
});
