import { expect, it } from 'vitest';
import { matches, parseFilter, ScimFilterError } from './filter';
import { applyPatch, readPatch } from './patch';

const user = {
  id: 'u1',
  userName: 'Ada@Example.com',
  externalId: 'ext-1',
  active: true,
  name: { givenName: 'Ada', familyName: 'Lovelace' },
  emails: [
    { value: 'ada@example.com', type: 'work', primary: true },
    { value: 'ada@home.example', type: 'home' },
  ],
  meta: { lastModified: '2026-10-01T10:00:00.000Z' },
};

it('filters as Okta and Entra write them select the right users (case-insensitive names and values, and/or precedence, value paths, not)', () => {
  const yes = [
    'userName eq "ada@example.com"',
    'USERNAME Eq "ADA@EXAMPLE.COM"',
    'urn:ietf:params:scim:schemas:core:2.0:User:userName eq "ada@example.com"',
    'externalId eq "ext-1" and active eq true',
    'emails[type eq "work"].value eq "ada@example.com"',
    'emails[type eq "home" and value co "home"]',
    'userName eq "nobody" or name.familyName sw "love" and active eq true',
    'not (userName eq "nobody")',
    'meta.lastModified gt "2026-09-30T00:00:00Z"',
    'name.givenName pr',
  ];
  const no = [
    'userName eq "ada"',
    'emails[type eq "home"].value eq "ada@example.com"',
    '(userName eq "nobody" or name.familyName sw "love") and active eq false',
    'title pr',
    'meta.lastModified lt "2026-09-30T00:00:00Z"',
  ];
  for (const f of yes) expect([f, matches(parseFilter(f), user)]).toEqual([f, true]);
  for (const f of no) expect([f, matches(parseFilter(f), user)]).toEqual([f, false]);
  // Entra's group membership test.
  const group = { id: 'g1', members: [{ value: 'u1' }, { value: 'u2' }] };
  expect(matches(parseFilter('id eq "g1" and members[value eq "u2"]'), group)).toBe(true);
  expect(matches(parseFilter('id eq "g1" and members[value eq "u3"]'), group)).toBe(false);
});

it('malformed filters are refused rather than matching everything', () => {
  for (const f of ['userName eq', 'userName like "a"', '(userName eq "a"', 'userName eq "a" garbage', 'emails[type eq "work"', 'userName eq "unterminated'])
    expect(() => parseFilter(f), f).toThrow(ScimFilterError);
});

it('PATCH as Entra sends it (capitalized ops, string booleans, value paths) and as Okta sends it (no path) both land', () => {
  const entra = applyPatch(
    user,
    readPatch({
      Operations: [
        { op: 'Replace', path: 'name.givenName', value: 'Augusta' },
        { op: 'Replace', path: 'emails[type eq "work"].value', value: 'augusta@example.com' },
        { op: 'Add', path: 'emails[type eq "other"].value', value: 'a@other.example' },
        { op: 'Remove', path: 'emails[type eq "home"]' },
        { op: 'Replace', path: 'active', value: 'False' },
      ],
    }),
  );
  expect(entra.name).toEqual({ givenName: 'Augusta', familyName: 'Lovelace' });
  expect(entra.emails).toEqual([
    { value: 'augusta@example.com', type: 'work', primary: true },
    { type: 'other', value: 'a@other.example' },
  ]);
  expect(entra.active).toBe('False'); // the caller reads it with scimBool
  const okta = applyPatch(user, readPatch({ Operations: [{ op: 'replace', value: { active: false, 'name.familyName': 'King' } }] }));
  expect([okta.active, (okta.name as { familyName: string }).familyName]).toEqual([false, 'King']);
  // The original is never modified.
  expect(user.emails).toHaveLength(2);
});

it('group member PATCHes add without duplicating and remove exactly the named members', () => {
  const g = { id: 'g1', displayName: 'Team', members: [{ value: 'u1' }, { value: 'u2' }] };
  const added = applyPatch(g, readPatch({ Operations: [{ op: 'add', path: 'members', value: [{ value: 'u2' }, { value: 'u3' }] }] }));
  expect((added.members as Array<{ value: string }>).map((m) => m.value)).toEqual(['u1', 'u2', 'u3']);
  const okta = applyPatch(added, readPatch({ Operations: [{ op: 'remove', path: 'members[value eq "u1"]' }] }));
  const entra = applyPatch(okta, readPatch({ Operations: [{ op: 'Remove', path: 'members', value: [{ value: 'u3' }] }] }));
  expect((entra.members as Array<{ value: string }>).map((m) => m.value)).toEqual(['u2']);
  const all = applyPatch(entra, readPatch({ Operations: [{ op: 'remove', path: 'members' }] }));
  expect(all.members).toBeUndefined();
});
