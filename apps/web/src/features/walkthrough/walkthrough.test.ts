import { describe, expect, it } from 'vitest';
import { cameraShowing, parseCaptionLines, pointerAt, TimelineRecorder, viewAt, type ViewRect } from './lib/timeline';

const rect = (x: number, y = 0): ViewRect => ({ x, y, w: 1600, h: 900 });

describe('recording and replaying the narrator’s path', () => {
  it('a pan after a long still pause starts when the narrator moved — playback holds still through the pause instead of drifting', () => {
    const rec = new TimelineRecorder();
    rec.view(0, rect(0));
    // Ten seconds of talking without moving (no camera events), then a pan.
    for (let t = 10_000; t <= 10_500; t += 16) rec.view(t, rect((t - 10_000) * 2));
    const tl = rec.finish(11_000);
    expect(viewAt(tl, 5_000)?.x).toBe(0);
    expect(viewAt(tl, 9_900)?.x).toBe(0);
    expect(viewAt(tl, 10_496)?.x).toBe(992); // the pan's last position
  });

  it('the end of a quick pan is where the view comes to rest, even when it came too soon after the last sample', () => {
    const rec = new TimelineRecorder();
    rec.view(0, rect(0));
    rec.view(100, rect(50));
    rec.view(110, rect(400)); // the last camera event of the pan, 10 ms later
    const tl = rec.finish(5_000);
    expect(viewAt(tl, 4_000)?.x).toBe(400);
  });

  it('the pointer is gone while the narrator’s pointer was off the board, and never glides across a jump', () => {
    const rec = new TimelineRecorder();
    rec.pointer(0, { x: 0, y: 0 });
    rec.pointer(1_000, null);
    rec.pointer(3_000, { x: 900, y: 900 });
    const tl = rec.finish(4_000);
    expect(pointerAt(tl, 500)).toEqual({ x: 0, y: 0 });
    expect(pointerAt(tl, 2_000)).toBeNull();
    expect(pointerAt(tl, 3_100)).toEqual({ x: 900, y: 900 });
  });

  it('a viewer on a smaller or differently shaped screen still sees everything the narrator saw', () => {
    const seen = rect(100, 200);
    for (const size of [
      { width: 800, height: 900 },
      { width: 1920, height: 600 },
    ]) {
      const cam = cameraShowing(seen, size);
      expect(cam.x).toBeLessThanOrEqual(seen.x + 1e-6);
      expect(cam.y).toBeLessThanOrEqual(seen.y + 1e-6);
      expect(cam.x + size.width / cam.zoom).toBeGreaterThanOrEqual(seen.x + seen.w - 1e-6);
      expect(cam.y + size.height / cam.zoom).toBeGreaterThanOrEqual(seen.y + seen.h - 1e-6);
    }
  });
});

it('typed captions each last until the next one starts (in time order), and lines without a time are skipped', () => {
  expect(parseCaptionLines('0:12 Then the roadmap\nnot a caption\n0:00 Welcome', 20_000)).toEqual([
    { start: 0, end: 12_000, text: 'Welcome' },
    { start: 12_000, end: 20_000, text: 'Then the roadmap' },
  ]);
});
