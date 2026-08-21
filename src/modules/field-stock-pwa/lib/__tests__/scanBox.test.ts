/**
 * squareScanBox — the decode region must be SQUARE and large enough for a
 * dense carton DataMatrix, on any phone in the fleet.
 *
 * The bug this replaces: a fixed 300x140 region. Square is the whole point —
 * a short region crops a 2D symbol, which is why the live camera could not
 * read a label that a still photo decodes fine.
 */
import { describe, it, expect } from 'vitest';
import { squareScanBox } from '../scanBox';

describe('squareScanBox', () => {
  it('is always square', () => {
    for (const [w, h] of [[390, 250], [250, 390], [1080, 1920], [320, 320]]) {
      const box = squareScanBox(w!, h!);
      expect(box.width).toBe(box.height);
    }
  });

  it('is far taller than the 140px region it replaces', () => {
    // A typical phone viewfinder. The old config gave 140px of height.
    expect(squareScanBox(390, 300).height).toBeGreaterThan(140);
  });

  it('is no narrower than the old region, so 1D barcodes still fit', () => {
    // 1D barcodes need width; the old box was 300 wide.
    expect(squareScanBox(500, 500).width).toBeGreaterThanOrEqual(300);
  });

  it('scales with the shorter viewfinder edge', () => {
    expect(squareScanBox(1000, 400).width).toBe(320); // 400 * 0.8
    expect(squareScanBox(400, 1000).width).toBe(320); // orientation-agnostic
  });

  it('never exceeds the viewfinder itself', () => {
    const box = squareScanBox(150, 150);
    expect(box.width).toBeLessThanOrEqual(150);
  });

  it('caps very large viewfinders rather than scanning the whole frame', () => {
    expect(squareScanBox(4000, 3000).width).toBe(480);
  });

  it('never returns a zero-sized box for an unmeasured viewfinder', () => {
    // A zero box silently disables scanning — worse than a wrong size.
    for (const [w, h] of [[0, 0], [-1, 500], [NaN, 500]]) {
      expect(squareScanBox(w!, h!).width).toBeGreaterThan(0);
    }
  });
});
