// Client-side SCIM 2.0 compliance run: the requests Okta and Entra ID provisioning send, in the
// order they send them (lookups by filter before creating, PUT vs PATCH, string booleans, group
// membership checks, pagination), with the answers they rely on. `npm run verify` runs it against
// a real server; it also runs standalone against any deployment:
//
//   node scripts/lib/scim-compliance.mjs --url https://freero.example.com/scim/v2 --token frscim_… --domain example.com
//
// It creates and deletes users `scim-<stamp>-…@<domain>` (the domain must be verified by the token's workspace).
import { pathToFileURL } from 'node:url';

const SCIM_JSON = 'application/scim+json';
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

export function scimClient(baseUrl, token) {
  return async function scim(method, path, body, { auth = token } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { accept: SCIM_JSON, ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { 'content-type': SCIM_JSON } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, type: res.headers.get('content-type') ?? '', location: res.headers.get('location') };
  };
}

const q = (s) => encodeURIComponent(s);

/**
 * Runs the Okta and Entra sequences. `check(name, fn)` / `assert(cond, msg)` come from the caller
 * (verify's, or the standalone ones below). Returns the ids it left (none on success).
 */
export async function runScimCompliance({ baseUrl, token, domain, check, assert }) {
  const scim = scimClient(baseUrl, token);
  const stamp = Date.now();
  const email = (who) => `scim-${stamp}-${who}@${domain}`;

  await check('SCIM: requests without a valid bearer token get 401 with a SCIM error body', async () => {
    const none = await scim('GET', '/Users', undefined, { auth: null });
    const wrong = await scim('GET', '/Users', undefined, { auth: 'frscim_not-a-token' });
    assert(none.status === 401 && wrong.status === 401 && wrong.json?.schemas?.[0] === ERROR && wrong.json.status === '401', `${none.status} ${wrong.status} ${wrong.text}`);
  });

  await check('SCIM discovery: ServiceProviderConfig says PATCH and filter are supported (bulk is not); ResourceTypes lists User and Group', async () => {
    const spc = await scim('GET', '/ServiceProviderConfig');
    assert(spc.status === 200 && spc.json.patch.supported === true && spc.json.filter.supported === true && spc.json.bulk.supported === false, spc.text);
    const rt = await scim('GET', '/ResourceTypes');
    assert(rt.json.Resources.map((r) => r.id).sort().join() === 'Group,User', rt.text);
  });

  // ---- Okta ----
  let okta = null;
  await check('SCIM (Okta): lookup by userName finds nobody, POST creates the user (201, Location, scim+json), the lookup then finds exactly that user', async () => {
    const userName = email('okta');
    const before = await scim('GET', `/Users?filter=${q(`userName eq "${userName}"`)}&startIndex=1&count=100`);
    assert(before.status === 200 && before.json.schemas[0] === LIST && before.json.totalResults === 0 && before.json.Resources.length === 0, before.text);
    const created = await scim('POST', '/Users', {
      schemas: [USER],
      userName,
      name: { givenName: 'Olive', familyName: 'Okta' },
      emails: [{ primary: true, value: userName, type: 'work' }],
      displayName: 'Olive Okta',
      locale: 'en-US',
      externalId: `00u${stamp}`,
      groups: [],
      password: 'ignored-by-freero-1',
      active: true,
    });
    assert(created.status === 201 && created.type.startsWith(SCIM_JSON) && created.location?.endsWith(`/Users/${created.json.id}`), `${created.status} ${created.type} ${created.text}`);
    assert(created.json.userName === userName && created.json.active === true && created.json.name.givenName === 'Olive' && created.json.emails[0].value === userName, created.text);
    const after = await scim('GET', `/Users?filter=${q(`userName eq "${userName.toUpperCase()}"`)}&startIndex=1&count=100`);
    assert(after.json.totalResults === 1 && after.json.Resources[0].id === created.json.id, `case-insensitive userName lookup: ${after.text}`);
    okta = created.json;
  });

  await check('SCIM (Okta): a second POST with the same userName is refused 409 uniqueness', async () => {
    const dup = await scim('POST', '/Users', { schemas: [USER], userName: okta.userName, emails: [{ primary: true, value: okta.userName }], active: true });
    assert(dup.status === 409 && dup.json.scimType === 'uniqueness', `${dup.status} ${dup.text}`);
  });

  await check('SCIM (Okta): PUT replaces the profile; PATCH replace {active:false} deactivates and {active:true} reactivates', async () => {
    const put = await scim('PUT', `/Users/${okta.id}`, { ...okta, name: { givenName: 'Olivia', familyName: 'Okta' }, displayName: 'Olivia Okta' });
    assert(put.status === 200 && put.json.name.givenName === 'Olivia' && put.json.displayName === 'Olivia Okta', put.text);
    const off = await scim('PATCH', `/Users/${okta.id}`, { schemas: [PATCH], Operations: [{ op: 'replace', value: { active: false } }] });
    assert(off.status === 200 && off.json.active === false, off.text);
    const got = await scim('GET', `/Users/${okta.id}`);
    assert(got.json.active === false, 'GET after deactivation');
    const on = await scim('PATCH', `/Users/${okta.id}`, { schemas: [PATCH], Operations: [{ op: 'replace', value: { active: true } }] });
    assert(on.status === 200 && on.json.active === true, on.text);
  });

  await check('SCIM (Okta): group push — POST /Groups, PATCH add members, rename with replace {id, displayName}, remove members[value eq …], filter by displayName, DELETE', async () => {
    const name = `Okta push ${stamp}`;
    const g = await scim('POST', '/Groups', { schemas: [GROUP], displayName: name, members: [] });
    assert(g.status === 201 && g.json.displayName === name && g.json.members.length === 0, g.text);
    const add = await scim('PATCH', `/Groups/${g.json.id}`, { schemas: [PATCH], Operations: [{ op: 'add', path: 'members', value: [{ value: okta.id, display: okta.userName }] }] });
    assert([200, 204].includes(add.status), add.text);
    assert((await scim('GET', `/Groups/${g.json.id}`)).json.members.map((m) => m.value).join() === okta.id, 'member not added');
    assert((await scim('GET', `/Users/${okta.id}`)).json.groups.some((x) => x.value === g.json.id), "the user's groups don't list it");
    const rename = await scim('PATCH', `/Groups/${g.json.id}`, { schemas: [PATCH], Operations: [{ op: 'replace', value: { id: g.json.id, displayName: `${name} (renamed)` } }] });
    assert([200, 204].includes(rename.status), rename.text);
    const found = await scim('GET', `/Groups?filter=${q(`displayName eq "${name} (renamed)"`)}`);
    assert(found.json.totalResults === 1 && found.json.Resources[0].id === g.json.id, found.text);
    const remove = await scim('PATCH', `/Groups/${g.json.id}`, { schemas: [PATCH], Operations: [{ op: 'remove', path: `members[value eq "${okta.id}"]` }] });
    assert([200, 204].includes(remove.status) && (await scim('GET', `/Groups/${g.json.id}`)).json.members.length === 0, remove.text);
    assert((await scim('DELETE', `/Groups/${g.json.id}`)).status === 204, 'delete group');
    assert((await scim('GET', `/Groups/${g.json.id}`)).status === 404, 'deleted group still answers');
  });

  // ---- Entra ID ----
  let entra = null;
  await check('SCIM (Entra): create with the enterprise extension, then find by externalId; filter `emails[type eq "work"].value eq …`', async () => {
    const userName = email('entra');
    assert((await scim('GET', `/Users?filter=${q(`userName eq "${userName}"`)}`)).json.totalResults === 0, 'lookup before create');
    const created = await scim('POST', '/Users', {
      schemas: [USER, ENTERPRISE],
      externalId: `entra-${stamp}`,
      userName,
      active: true,
      emails: [{ primary: true, type: 'work', value: userName }],
      meta: { resourceType: 'User' },
      name: { formatted: 'Edgar Entra', familyName: 'Entra', givenName: 'Edgar' },
      roles: [],
      [ENTERPRISE]: { department: 'Design', employeeNumber: '42' },
    });
    assert(created.status === 201, created.text);
    entra = created.json;
    const byExternal = await scim('GET', `/Users?filter=${q(`externalId eq "entra-${stamp}"`)}`);
    assert(byExternal.json.totalResults === 1 && byExternal.json.Resources[0].id === entra.id, byExternal.text);
    const byEmail = await scim('GET', `/Users?filter=${q(`emails[type eq "work"].value eq "${userName}"`)}`);
    assert(byEmail.json.totalResults === 1, byEmail.text);
  });

  await check('SCIM (Entra): PATCH with capitalized ops and paths — displayName, name.givenName, emails[type eq "work"].value, Add externalId; "False" (a string) deactivates', async () => {
    const r = await scim('PATCH', `/Users/${entra.id}`, {
      schemas: [PATCH],
      Operations: [
        { op: 'Replace', path: 'displayName', value: 'Edgar E.' },
        { op: 'Replace', path: 'name.givenName', value: 'Ed' },
        { op: 'Replace', path: 'emails[type eq "work"].value', value: entra.userName },
        { op: 'Add', path: 'externalId', value: `entra-${stamp}-b` },
        { op: 'Add', path: `${ENTERPRISE}:manager`, value: 'ignored' },
      ],
    });
    assert(r.status === 200 && r.json.displayName === 'Edgar E.' && r.json.name.givenName === 'Ed' && r.json.externalId === `entra-${stamp}-b`, r.text);
    const off = await scim('PATCH', `/Users/${entra.id}`, { schemas: [PATCH], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] });
    assert(off.status === 200 && off.json.active === false, off.text);
    const on = await scim('PATCH', `/Users/${entra.id}`, { schemas: [PATCH], Operations: [{ op: 'Replace', path: 'active', value: 'True' }] });
    assert(on.json.active === true, on.text);
  });

  await check('SCIM (Entra): groups — lookup with excludedAttributes=members, Add/Remove members by value list, membership test `id eq … and members[value eq …]`, Replace displayName', async () => {
    const name = `Entra group ${stamp}`;
    const none = await scim('GET', `/Groups?excludedAttributes=members&filter=${q(`displayName eq "${name}"`)}`);
    assert(none.json.totalResults === 0, none.text);
    const g = await scim('POST', '/Groups', { schemas: [GROUP], externalId: `grp-${stamp}`, displayName: name, members: [] });
    assert(g.status === 201, g.text);
    const add = await scim('PATCH', `/Groups/${g.json.id}`, { schemas: [PATCH], Operations: [{ op: 'Add', path: 'members', value: [{ value: entra.id }, { value: okta.id }] }] });
    assert([200, 204].includes(add.status), add.text);
    const isMember = await scim('GET', `/Groups?excludedAttributes=members&filter=${q(`id eq "${g.json.id}" and members[value eq "${entra.id}"]`)}`);
    assert(isMember.json.totalResults === 1 && isMember.json.Resources[0].members === undefined, `membership test: ${isMember.text}`);
    const rm = await scim('PATCH', `/Groups/${g.json.id}`, { schemas: [PATCH], Operations: [{ op: 'Remove', path: 'members', value: [{ value: entra.id }] }] });
    assert([200, 204].includes(rm.status), rm.text);
    const left = (await scim('GET', `/Groups/${g.json.id}`)).json.members.map((m) => m.value);
    assert(left.length === 1 && left[0] === okta.id, `members after Remove: ${left}`);
    const notMember = await scim('GET', `/Groups?excludedAttributes=members&filter=${q(`id eq "${g.json.id}" and members[value eq "${entra.id}"]`)}`);
    assert(notMember.json.totalResults === 0, notMember.text);
    const ren = await scim('PATCH', `/Groups/${g.json.id}`, { schemas: [PATCH], Operations: [{ op: 'Replace', path: 'displayName', value: `${name} 2` }] });
    assert([200, 204].includes(ren.status) && (await scim('GET', `/Groups/${g.json.id}`)).json.displayName === `${name} 2`, ren.text);
    assert((await scim('DELETE', `/Groups/${g.json.id}`)).status === 204, 'delete group');
  });

  await check('SCIM pagination: startIndex/count page through users (1-based, itemsPerPage, totalResults), count=0 only counts', async () => {
    const all = (await scim('GET', '/Users?count=200')).json;
    assert(all.totalResults >= 2, `only ${all.totalResults} users`);
    const p2 = (await scim('GET', '/Users?startIndex=2&count=1')).json;
    assert(p2.startIndex === 2 && p2.itemsPerPage === 1 && p2.Resources[0].id === all.Resources[1].id && p2.totalResults === all.totalResults, JSON.stringify(p2).slice(0, 300));
    const zero = (await scim('GET', '/Users?count=0')).json;
    assert(zero.totalResults === all.totalResults && zero.Resources.length === 0, JSON.stringify(zero));
  });

  await check('SCIM errors: an unknown user is 404 and an unparsable filter 400 invalidFilter, both as SCIM error bodies', async () => {
    const missing = await scim('GET', '/Users/does-not-exist');
    assert(missing.status === 404 && missing.json.schemas[0] === ERROR && missing.json.status === '404', missing.text);
    const bad = await scim('GET', `/Users?filter=${q('userName eq')}`);
    assert(bad.status === 400 && bad.json.scimType === 'invalidFilter', bad.text);
  });

  await check('SCIM: DELETE /Users/:id removes the user (204; then 404)', async () => {
    for (const u of [okta, entra]) {
      assert((await scim('DELETE', `/Users/${u.id}`)).status === 204, `delete ${u.userName}`);
      assert((await scim('GET', `/Users/${u.id}`)).status === 404, `${u.userName} still answers`);
    }
  });
}

// Standalone: node scripts/lib/scim-compliance.mjs --url … --token … --domain …
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  let failed = 0;
  await runScimCompliance({
    baseUrl: arg('url'),
    token: arg('token'),
    domain: arg('domain'),
    assert: (c, m) => {
      if (!c) throw new Error(m);
    },
    check: async (name, fn) => {
      try {
        await fn();
        console.log(`PASS  ${name}`);
      } catch (e) {
        failed++;
        console.log(`FAIL  ${name}\n        ${e.message}`);
      }
    },
  });
  process.exit(failed ? 1 : 0);
}
