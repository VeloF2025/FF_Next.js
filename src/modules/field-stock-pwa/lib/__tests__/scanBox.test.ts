/**
 * scanRegionFor — the decode region must be SQUARE and large enough for a
 * dense carton DataMatrix, on any phone in the fleet.
 *
 * The bug this replaces: a fixed 300x140 region. Square is the whole point —
 * a short region crops a 2D symbol, which is why the live camera could not
 * read a label that a still photo decodes fine.
 */
import { describe, it, expect } from 'vitest';
import { scanRegionFor } from '../scanBox';

describe('scanRegionFor', () => {
  it('is never worse than the 300x140 region it replaced, on real phone sizes', () => {
    // The invariant that actually matters. Squareness was the FIRST attempt and
    // was wrong: on a wide-but-short viewfinder a square throws away width the
    // frame was offering, ending up narrower than 300 and regressing 1D.
    for (const [w, h] of [[360, 300], [390, 350], [414, 360], [320, 280], [375, 375], [360, 260]]) {
      const box = scanRegionFor(w!, h!);
      expect(box.width, `width on ${w}x${h}`).toBeGreaterThanOrEqual(Math.min(300, w!));
      expect(box.height, `height on ${w}x${h}`).toBeGreaterThan(140);
    }
  });

  it('never exceeds either dimension of the frame', () => {
    for (const [w, h] of [[390, 250], [250, 390], [150, 150], [1080, 1920], [320, 280]]) {
      const box = scanRegionFor(w!, h!);
      expect(box.width).toBeLessThanOrEqual(w!);
      expect(box.height).toBeLessThanOrEqual(h!);
    }
  });

  it('is far taller than the 140px region it replaces', () => {
    // A typical phone viewfinder. The old config gave 140px of height — the
    // reason a dense carton DataMatrix could not resolve in live video.
    expect(scanRegionFor(390, 300).height).toBeGreaterThan(140);
  });

  it('is no narrower than the old region ON REAL PHONE SIZES, so 1D still fits', () => {
    // 1D barcodes need width; the old box was 300 wide. The previous version of
    // this test only checked 500x500 — larger than any phone here — so it passed
    // while the formula actually returned 240-280 on real devices, NARROWER than
    // before. These are the sizes that matter.
    for (const [w, h] of [[360, 300], [390, 350], [414, 360], [320, 280], [375, 375]]) {
      const box = scanRegionFor(w!, h!);
      expect(
        box.width,
        `viewfinder ${w}x${h} produced a ${box.width}px box, narrower than the 300px it replaced`,
      ).toBeGreaterThanOrEqual(300);
    }
  });

  it('still gives 2D far more height than the 140px it replaced, at those sizes', () => {
    for (const [w, h] of [[360, 300], [390, 350], [320, 280]]) {
      expect(scanRegionFor(w!, h!).height).toBeGreaterThan(140);
    }
  });

  it('scales each axis with its own frame dimension', () => {
    // 1000*0.9 capped at 480; 500*0.9 = 450.
    expect(scanRegionFor(1000, 500)).toEqual({ width: 480, height: 450 });
    expect(scanRegionFor(500, 1000)).toEqual({ width: 450, height: 480 });
  });

  it('never exceeds the viewfinder itself', () => {
    const box = scanRegionFor(150, 150);
    expect(box.width).toBeLessThanOrEqual(150);
  });

  it('caps very large viewfinders rather than scanning the whole frame', () => {
    expect(scanRegionFor(4000, 3000)).toEqual({ width: 480, height: 480 });
  });

  it('never returns a zero-sized box for an unmeasured viewfinder', () => {
    // A zero box silently disables scanning — worse than a wrong size.
    for (const [w, h] of [[0, 0], [-1, 500], [NaN, 500], [NaN, NaN]]) {
      expect(scanRegionFor(w!, h!).width).toBeGreaterThan(0);
    }
  });

  it('uses the one real dimension when the other is unmeasured', () => {
    // Falling back to a fixed size while a real SMALL dimension exists would
    // produce a box bigger than the frame — the one thing this must never do.
    expect(scanRegionFor(NaN, 120).width).toBeLessThanOrEqual(120);
    expect(scanRegionFor(50, NaN).height).toBeLessThanOrEqual(50);
    expect(scanRegionFor(0, 180).width).toBeLessThanOrEqual(180);
  });
});
