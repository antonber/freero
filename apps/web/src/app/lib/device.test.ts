import { expect, it } from 'vitest';
import { describeDevice } from '@freero/shared';

// describeDevice (@freero/shared) labels the signed-in devices list and the security notices.
// Browsers impersonate each other in their User-Agent; a wrong label makes people sign out the
// wrong device.
it('does not mislabel Edge, iPhone Chrome or iPad Safari as the browsers they imitate', () => {
  expect(
    describeDevice(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    ),
  ).toBe('Edge on Windows');
  expect(
    describeDevice(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
    ),
  ).toBe('Chrome on iPhone');
  expect(
    describeDevice('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
  ).toBe('Safari on iPad');
});
