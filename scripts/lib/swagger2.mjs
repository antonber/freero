// OpenAPI 3.1 → Swagger (OpenAPI) 2.0, for a Power Automate / Logic Apps custom connector (#88):
// "The OpenAPI definition needs to be in OpenAPI 2.0 … OpenAPI 3.0 format are not supported", under
// 1 MB (learn.microsoft.com/connectors/custom-connectors/define-openapi-definition, …/faq).
// Pure and deterministic: the same openapi.json always gives the same file (a test keeps them in step).
//
// What changes on the way down:
//   - servers → host + basePath + schemes (https); components → definitions / parameters / responses;
//   - requestBody → one `in: body` parameter; content → produces + `schema`; parameter `schema` → its
//     type keywords on the parameter itself; response header `schema` → its type;
//   - 3.1 schema keywords 2.0 doesn't have: `type: [T, "null"]` and `oneOf: [X, {type: null}]` → T / X
//     with `x-nullable: true`; any other `oneOf` / `anyOf` → its first alternative (the other one is
//     still in the REST reference); `const: v` → `enum: [v]`; a type list without null → no type;
//   - security: the connector asks for one API key, sent as `Authorization: Bearer frp_…` (a personal
//     access token from Settings → API tokens). OAuth needs an app registered per connector, which
//     the guide explains instead.

const REF = /^#\/components\/(schemas|parameters|responses)\/(.+)$/;
const SECTION = { schemas: 'definitions', parameters: 'parameters', responses: 'responses' };
const ref = (r) => {
  const m = REF.exec(r);
  if (!m) throw new Error(`Unsupported $ref ${r}`);
  return `#/${SECTION[m[1]]}/${m[2]}`;
};

/** A JSON Schema of OpenAPI 3.1 as the Swagger 2.0 schema subset. */
export function schema2(s) {
  if (!s || typeof s !== 'object') return s;
  if (s.$ref) return { $ref: ref(s.$ref) };
  const out = {};
  let nullable = false;
  let alt = null;
  for (const key of ['oneOf', 'anyOf']) {
    if (!Array.isArray(s[key])) continue;
    const real = s[key].filter((x) => x?.type !== 'null');
    nullable ||= real.length < s[key].length;
    alt = real[0] ?? {};
  }
  if (alt) Object.assign(out, schema2(alt));
  for (const [k, v] of Object.entries(s)) {
    switch (k) {
      case 'oneOf':
      case 'anyOf':
      case 'examples':
      case '$schema':
        break;
      case 'type':
        if (Array.isArray(v)) {
          const real = v.filter((t) => t !== 'null');
          nullable ||= real.length < v.length;
          if (real.length === 1) out.type = real[0];
        } else out.type = v;
        break;
      case 'const':
        out.enum = [v];
        break;
      case 'properties':
        out.properties = Object.fromEntries(Object.entries(v).map(([name, p]) => [name, schema2(p)]));
        break;
      case 'items':
        out.items = schema2(v);
        break;
      case 'allOf':
        out.allOf = v.map(schema2);
        break;
      case 'additionalProperties':
        out.additionalProperties = typeof v === 'object' ? schema2(v) : v;
        break;
      default:
        out[k] = v;
    }
  }
  if (nullable) out['x-nullable'] = true;
  // 2.0 ignores everything beside a $ref: the reference goes into allOf so the rest still counts.
  if (out.$ref && Object.keys(out).length > 1) {
    const { $ref, ...rest } = out;
    return { allOf: [{ $ref }], ...rest };
  }
  return out;
}

/** A query / path / header parameter: its schema's keywords on the parameter (2.0 has no `schema` there). */
function parameter2(p) {
  if (p.$ref) return { $ref: ref(p.$ref) };
  const { schema, example: _e, examples: _x, ...rest } = p;
  const s = schema2(schema ?? { type: 'string' });
  const flat = { ...rest, ...s };
  if (flat.type === 'object' || flat.$ref || !flat.type) flat.type = 'string';
  delete flat.$ref;
  delete flat.properties;
  delete flat['x-nullable'];
  if (p.in === 'path') flat.required = true;
  return flat;
}

function response2(r) {
  if (r.$ref) return { $ref: ref(r.$ref) };
  const out = { description: r.description ?? '' };
  const content = r.content ?? {};
  const json = content['application/json'] ?? Object.values(content)[0];
  if (json?.schema) out.schema = schema2(json.schema);
  if (r.headers)
    out.headers = Object.fromEntries(
      Object.entries(r.headers).map(([name, h]) => {
        const s = schema2(h.schema ?? { type: 'string' });
        return [name, { type: s.type ?? 'string', ...(h.description ? { description: h.description } : {}) }];
      }),
    );
  return out;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

function operation2(op) {
  const out = {};
  for (const k of ['tags', 'summary', 'description', 'operationId', 'deprecated']) if (op[k] !== undefined) out[k] = op[k];
  for (const [k, v] of Object.entries(op)) if (k.startsWith('x-')) out[k] = v;
  const params = (op.parameters ?? []).map(parameter2);
  if (op.requestBody) {
    const body = op.requestBody.content?.['application/json'];
    if (body) params.push({ in: 'body', name: 'body', required: !!op.requestBody.required, ...(op.requestBody.description ? { description: op.requestBody.description } : {}), schema: schema2(body.schema ?? {}) });
  }
  if (params.length) out.parameters = params;
  const types = new Set();
  for (const r of Object.values(op.responses ?? {})) for (const t of Object.keys(r.content ?? {})) types.add(t);
  if ([...types].some((t) => t !== 'application/json')) out.produces = ['application/json', ...[...types].filter((t) => t !== 'application/json').sort()];
  out.responses = Object.fromEntries(Object.entries(op.responses ?? {}).map(([code, r]) => [code, response2(r)]));
  return out;
}

/** The connector definition for an instance at `host` (e.g. "boards.example.com"). */
export function toSwagger2(openapi, { host = 'freero.example.com' } = {}) {
  const basePath = openapi.servers?.[0]?.url ?? '/';
  const info = { title: 'Freero', version: openapi.info.version, description: `${openapi.info.title}. ${openapi.info.summary ?? ''}`.trim() };
  if (openapi.info.license) info.license = openapi.info.license;
  const paths = {};
  for (const [p, item] of Object.entries(openapi.paths)) {
    const shared = (item.parameters ?? []).map(parameter2);
    const out = {};
    if (shared.length) out.parameters = shared;
    for (const m of METHODS) if (item[m]) out[m] = operation2(item[m]);
    paths[p] = out;
  }
  const c = openapi.components ?? {};
  return {
    swagger: '2.0',
    info,
    host,
    basePath,
    schemes: ['https'],
    consumes: ['application/json'],
    produces: ['application/json'],
    securityDefinitions: {
      api_key: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'Bearer frp_… — a personal access token (Settings → API tokens)' },
    },
    security: [{ api_key: [] }],
    paths,
    definitions: Object.fromEntries(Object.entries(c.schemas ?? {}).map(([k, v]) => [k, schema2(v)])),
    parameters: Object.fromEntries(Object.entries(c.parameters ?? {}).map(([k, v]) => [k, parameter2(v)])),
    responses: Object.fromEntries(Object.entries(c.responses ?? {}).map(([k, v]) => [k, response2(v)])),
  };
}
