import { describe, expect, it } from 'vitest';
import { estimateOffset, type ClockSample } from './serverClock';

const MINUTE = 60_000;

/** What a client measures from the server's 1-second `Date` header when its clock is `skew` ms off. */
function samplesFor(skew: number, serverStart: number, latency = 40): ClockSample[] {
  return [0, 210, 420, 630, 840].map((t) => {
    const serverAtResponse = serverStart + t + latency;
    const localSent = serverStart + t + skew;
    return {
      sentAt: localSent,
      receivedAt: localSent + 2 * latency,
      serverDate: Math.floor(serverAtResponse / 1000) * 1000,
    };
  });
}

describe('server clock estimate', () => {
  it('corrects a client clock that is 7 minutes fast to within 0.3 s, despite the 1 s Date header', () => {
    const skew = 7 * MINUTE;
    const offset = estimateOffset(samplesFor(skew, 1_700_000_120_250))!;
    expect(Math.abs(offset + skew)).toBeLessThan(300);
  });

  it('trusts the latest sample instead of averaging across a clock jump mid-measurement', () => {
    const before = samplesFor(0, 1_700_000_000_000).slice(0, 2);
    const after = samplesFor(-5 * MINUTE, 1_700_000_000_500).slice(2);
    const offset = estimateOffset([...before, ...after])!;
    expect(Math.abs(offset - 5 * MINUTE)).toBeLessThan(1500);
  });
});
