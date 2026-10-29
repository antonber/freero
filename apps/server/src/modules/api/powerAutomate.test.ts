// The Power Automate custom connector (#88, docs/integrations/power-automate.md) is generated from
// docs/api/openapi.json by `npm run gen:power-automate`. Power Automate imports only Swagger 2.0 under
// 1 MB (learn.microsoft.com/connectors/custom-connectors/define-openapi-definition), so: the checked-in
// file is what the generator makes from today's openapi.json, and it holds no OpenAPI 3 construct a
// 2.0 importer would refuse or misread.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

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
      if (m === 'parameters') continue;
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
  const auth = Object.values(doc.securityDefinitions ?? {}) as Json[];
  if (auth.length !== 1 || auth[0].type !== 'apiKey' || auth[0].in !== 'header' || auth[0].name !== 'Authorization') out.push('one API key in the Authorization header');
  return out;
}

it('the Power Automate connector is what npm run gen:power-automate makes from today’s openapi.json, valid Swagger 2.0 under 1 MB with every operation', async () => {
  const { toSwagger2 } = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/swagger2.mjs')).href)) as { toSwagger2: (o: Json, opts: { host: string }) => Json };
  const openapi = JSON.parse(read('docs/api/openapi.json'));
  const text = read('docs/integrations/power-automate/freero.swagger.json');
  const shipped = JSON.parse(text);
  expect(shipped, 'docs/integrations/power-automate/freero.swagger.json is out of date: run npm run gen:power-automate').toEqual(toSwagger2(openapi, { host: 'freero.example.com' }));
  expect(swagger2Problems(shipped)).toEqual([]);
  expect(Buffer.byteLength(text)).toBeLessThan(1024 * 1024);
  const operations = (doc: Json) =>
    Object.entries(doc.paths as Json)
      .flatMap(([p, item]) => Object.entries(item as Json).filter(([m]) => m !== 'parameters').map(([m, op]) => `${m} ${p} ${(op as Json).operationId}`))
      .sort();
  expect(operations(shipped)).toEqual(operations(openapi));
});
