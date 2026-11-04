// What the sensitive-data scan looks for (#158; docs/design/compliance.md §2), as pure functions over
// text. Only formats that are unambiguous on their own, each checked further where it has a check:
//   payment_card  13–19 digits (spaces or dashes between groups), a known card network's prefix and
//                 a valid Luhn check digit
//   iban          a country's IBAN length and a valid mod-97 check
//   national_id   US Social Security numbers written AAA-GG-SSSS (no area 000, 666 or 9xx, no group
//                 00, no serial 0000) and UK National Insurance numbers (valid prefixes, A–D suffix)
//   secret        credentials recognisable by their issuer's prefix: AWS access key ids, GitHub,
//                 GitLab, Slack, Stripe live, Google API, npm, SendGrid, OpenAI / Anthropic keys and
//                 private key blocks (PEM / OpenSSH)
//   email, phone  optional (off by default): an email address; an international number (+…)
// The result is how many of each kind a text holds — never what matched. Callers keep no text.
import type { SensitiveDataKind } from '@freero/shared';

const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

/** Visa, Mastercard (51–55, 2221–2720), American Express, Discover, Diners Club, JCB, UnionPay, Maestro: and the lengths each issues. */
function cardNetwork(d: string): boolean {
  const n = d.length;
  const p2 = Number(d.slice(0, 2));
  const p3 = Number(d.slice(0, 3));
  const p4 = Number(d.slice(0, 4));
  const p6 = Number(d.slice(0, 6));
  if (d[0] === '4') return n === 13 || n === 16 || n === 19;
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16;
  if (p2 === 34 || p2 === 37) return n === 15;
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649) || (p6 >= 622126 && p6 <= 622925)) return n >= 16 && n <= 19;
  if (p2 === 36 || p2 === 38 || (p3 >= 300 && p3 <= 305)) return n >= 14 && n <= 19;
  if (p4 >= 3528 && p4 <= 3589) return n >= 16 && n <= 19;
  if (p2 === 62) return n >= 16 && n <= 19;
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return n >= 12 && n <= 19;
  return false;
}

// Digits in groups (a space or a dash between them), not glued to other digits or letters.
const CARD_RE = /(?<![\dA-Za-z])\d(?:[ -]?\d){11,}(?![\dA-Za-z])/g;

/** IBAN lengths by country (ISO 13616 registry). */
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};
const IBAN_RE = /(?<![A-Za-z0-9])([A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30})(?![A-Za-z0-9])/g;

/** A run starting with an IBAN (what follows it may be glued on by the pattern: "… 00 TODAY"). */
function ibanValid(raw: string): boolean {
  const all = raw.replace(/ /g, '');
  const length = IBAN_LENGTH[all.slice(0, 2)];
  if (!length || all.length < length) return false;
  const s = all.slice(0, length);
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const SSN_RE = /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g;
// Prefix letters: not D, F, I, Q, U, V; second not O; and never BG, GB, KN, NK, NT, TN, ZZ. Suffix A–D.
const NINO_RE = /(?<![A-Za-z0-9])(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D](?![A-Za-z0-9])/g;

const SECRET_RES: RegExp[] = [
  /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab personal access token
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, // Stripe live secret / restricted keys
  /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g, // Google API key
  /\bnpm_[A-Za-z0-9]{36}\b/g, // npm access token
  /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, // SendGrid
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic API key
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}/g, // OpenAI API key
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
];

const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
// "+" and a country code, then 7–14 more digits with the usual separators.
const PHONE_RE = /(?<![\w+])\+[1-9](?:[ .-]?\(?\d\)?){7,14}(?!\d)/g;

const count = (text: string, re: RegExp, ok: (m: string) => boolean = () => true): number => {
  let n = 0;
  for (const m of text.matchAll(re)) if (ok(m[0])) n++;
  return n;
};

/** A card number among a run of digit groups ("Order 12 4111 1111 1111 1111 12/27"): any consecutive groups that are one. */
function holdsCard(run: string): boolean {
  const groups = run.split(/[ -]/);
  for (let i = 0; i < groups.length; i++) {
    let d = '';
    for (let j = i; j < groups.length; j++) {
      d += groups[j];
      if (d.length > 19) break;
      if (d.length >= 13 && !/^(\d)\1+$/.test(d) && cardNetwork(d) && luhn(d)) return true;
    }
  }
  return false;
}

const DETECTORS: Record<SensitiveDataKind, (text: string) => number> = {
  payment_card: (t) => count(t, CARD_RE, holdsCard),
  iban: (t) => count(t, IBAN_RE, ibanValid),
  national_id: (t) => count(t, SSN_RE) + count(t, NINO_RE),
  secret: (t) => SECRET_RES.reduce((n, re) => n + count(t, re), 0),
  email: (t) => count(t, EMAIL_RE),
  phone: (t) => count(t, PHONE_RE, (m) => m.replace(/\D/g, '').length >= 8),
};

/** How many of each asked-for kind `text` holds (kinds with none are left out). */
export function detectSensitiveData(text: string, kinds: readonly SensitiveDataKind[]): Partial<Record<SensitiveDataKind, number>> {
  const out: Partial<Record<SensitiveDataKind, number>> = {};
  if (!text) return out;
  for (const k of kinds) {
    const n = DETECTORS[k](text);
    if (n) out[k] = n;
  }
  return out;
}
