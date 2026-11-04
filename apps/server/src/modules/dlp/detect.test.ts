// What the sensitive-data scan reports (#158): only what its checks confirm, so admins aren't
// flooded by order numbers and dates, and real card numbers and keys aren't missed for their
// formatting.
import { expect, it } from 'vitest';
import { DEFAULT_SENSITIVE_DATA_KINDS, SENSITIVE_DATA_KINDS } from '@freero/shared';
import { detectSensitiveData } from './detect';

const found = (text: string) => detectSensitiveData(text, DEFAULT_SENSITIVE_DATA_KINDS);

it('reports card numbers, IBANs, ID numbers and keys however they are written, and only when their check digits and formats hold', () => {
  expect(found('Card 4111 1111 1111 1111 exp 12/27')).toEqual({ payment_card: 1 });
  expect(found('order 12 5500-0000-0000-0004 (copy)')).toEqual({ payment_card: 1 });
  expect(found('amex 378282246310005')).toEqual({ payment_card: 1 });
  expect(found('Pay to DE89 3704 0044 0532 0130 00 TODAY')).toEqual({ iban: 1 });
  expect(found('GB82WEST12345698765432')).toEqual({ iban: 1 });
  expect(found('SSN 078-05-1120, NI JG 10 37 59 A')).toEqual({ national_id: 2 });
  expect(found('AKIAIOSFODNN7EXAMPLE and ghp_' + 'a'.repeat(36))).toEqual({ secret: 2 });
  expect(found('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA')).toEqual({ secret: 1 });

  // Near misses: a mistyped card (Luhn fails), digits that are no card network's, a phone-like run,
  // an IBAN with a wrong check digit, reserved SSN areas, dates and amounts.
  expect(found('Card 4111 1111 1111 1112')).toEqual({});
  expect(found('Tracking 1234567812345670')).toEqual({});
  expect(found('Order 0000 0000 0000 0000')).toEqual({});
  expect(found('DE88 3704 0044 0532 0130 00')).toEqual({});
  expect(found('000-12-3456 666-12-3456 900-12-3456 123-00-4567')).toEqual({});
  expect(found('Due 2026-11-03, budget 1,250,000.00, call 2026 1103 1200')).toEqual({});
});

it('looks for email addresses and phone numbers only when the workspace asked for them', () => {
  const text = 'Reach ana@example.com or +44 20 7946 0958';
  expect(found(text)).toEqual({});
  expect(detectSensitiveData(text, SENSITIVE_DATA_KINDS)).toEqual({ email: 1, phone: 1 });
});
