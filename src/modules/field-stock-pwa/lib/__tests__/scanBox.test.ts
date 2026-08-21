/**
 * scanRegionFor — the decode region must be large enough on BOTH axes for a
 * dense carton DataMatrix, on any phone in the fleet.
 *
 * The bug this replaces: a fixed 300x140 region. A short region crops a 2D
 * symbol, which is why the live camera could not read a label that a still
 * photo decodes fine. NOT square: squareness was the first attempt and it
 * regressed 1D scanning on a wide-but-short frame.
 *
 * Hand-picked "real phone" sizes are not enough to characterise this function.
 * It is piecewise over four regimes per axis, and a defect lived precisely in
 * the band where BOTH axes sit in their flat target band at once — a band no
 * hand-picked pair happened to hit. The sweeps below replace guessing at
 * inputs with covering the space.
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
  // --- Sweeps over the whole plausible viewfinder space -------------------
  // These exist because six hand-picked pairs missed a real defect. The
  // function is piecewise (passthrough / flat-at-target / linear / capped) on
  // each axis independently, so the interesting cases are the combinations of
  // regimes, not any one device size.

  const SWEEP: Array<[number, number]> = [];
  for (let w = 200; w <= 1200; w += 1) {
    for (let h = 200; h <= 1200; h += 7) SWEEP.push([w, h]);
  }

  it('never produces the 300x260 geometry the measurements record as FAILING', () => {
    // The defect this test was written for. MIN_HEIGHT used to be 260 — the
    // symbol's own height — so every viewfinder in width 300-334 x height
    // 260-289 emitted exactly the region the carton photo fails to decode in.
    // 1,050 sizes hit it. Setting MIN_HEIGHT back to 260 turns this RED.
    const failing = SWEEP.filter(([w, h]) => {
      const box = scanRegionFor(w, h);
      return box.width === 300 && box.height === 260;
    });
    expect(
      failing.slice(0, 5),
      `${failing.length} viewfinder sizes emit the documented-failing 300x260 region`,
    ).toEqual([]);
  });

  it('gives a 2D symbol room beyond its own height wherever the frame allows', () => {
    // The quiet-zone rule, stated as an invariant rather than as a size: a
    // frame tall enough to offer more than the 260px symbol must not be
    // handed a region that merely equals it.
    for (const [w, h] of SWEEP) {
      if (h < 300) continue;
      expect(scanRegionFor(w, h).height, `height on ${w}x${h}`).toBeGreaterThan(260);
    }
  });

  it('never hands html5-qrcode a box it will throw on', () => {
    // Verified against html5-qrcode 2.3.8: it truncates only WIDTH against the
    // root element, never height, then throws from getShadedRegionBounds if
    // EITHER axis exceeds the frame, and throws again below MIN_QR_BOX_SIZE.
    // So both bounds are the library's contract, not a preference of ours.
    const MIN_QR_BOX_SIZE = 50;
    for (const [w, h] of SWEEP) {
      const box = scanRegionFor(w, h);
      expect(box.width, `width on ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(box.height, `height on ${w}x${h}`).toBeLessThanOrEqual(h);
      expect(box.width, `width on ${w}x${h}`).toBeGreaterThanOrEqual(MIN_QR_BOX_SIZE);
      expect(box.height, `height on ${w}x${h}`).toBeGreaterThanOrEqual(MIN_QR_BOX_SIZE);
    }
  });

  it('is never narrower than the 300px region it replaced, across the sweep', () => {
    // 1D needs width. Stated over the whole space, not over five phones.
    for (const [w, h] of SWEEP) {
      expect(scanRegionFor(w, h).width, `width on ${w}x${h}`).toBeGreaterThanOrEqual(
        Math.min(300, w),
      );
    }
  });

  it('covers each regime boundary on both axes explicitly', () => {
    // MIN_EDGE/0.9 ~= 333.3, MIN_HEIGHT/0.9 ~= 333.3, MAX_EDGE/0.9 ~= 533.3.
    expect(scanRegionFor(333, 333)).toEqual({ width: 300, height: 300 }); // flat at target
    expect(scanRegionFor(334, 334)).toEqual({ width: 300, height: 300 }); // floor(300.6)=300
    expect(scanRegionFor(400, 400)).toEqual({ width: 360, height: 360 }); // linear
    expect(scanRegionFor(533, 533)).toEqual({ width: 479, height: 479 }); // just under cap
    expect(scanRegionFor(534, 534)).toEqual({ width: 480, height: 480 }); // capped
  });
});
