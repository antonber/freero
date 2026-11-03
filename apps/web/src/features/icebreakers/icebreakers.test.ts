import { expect, it } from 'vitest';
import { wheelAngle } from './lib/model';

it('the wheel stops with the slice the server picked under the pointer, for any number of names', () => {
  for (const of of [1, 2, 3, 7, 12]) {
    const seg = 360 / of;
    for (let index = 0; index < of; index++) {
      const center = index * seg + seg / 2;
      const atPointer = (((center + wheelAngle({ index, of }, 1)) % 360) + 360) % 360;
      expect(Math.min(atPointer, 360 - atPointer), `${index} of ${of}`).toBeCloseTo(0, 6);
    }
  }
});

