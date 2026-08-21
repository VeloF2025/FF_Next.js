/**
 * scanBox.ts — how big, and what shape, the camera's decode region should be.
 *
 * html5-qrcode only decodes INSIDE the qrbox. The stores scanner used a fixed
 * 300x140 region — a wide, short rectangle shaped for a 1D barcode. A Nokia
 * carton's serial-list DataMatrix is square and dense, so at 140px tall it was
 * cropped or downscaled below the resolution needed to resolve its modules:
 * the live camera could not read a label that decodes fine from a still photo
 * (reported from the field 2026-08-21).
 *
 * A square region fixes that without hurting 1D scanning, because a 1D barcode
 * needs WIDTH and the square is no narrower than the old rectangle was.
 *
 * Sized from the actual viewfinder rather than a constant: a scan box larger
 * than the video frame is clamped or ignored depending on version, and phones
 * in this fleet range from small iPhones to large Androids.
 */

/** Fraction of the shorter viewfinder edge the decode region should span. */
const EDGE_FRACTION = 0.8;
/** Never smaller than this — below it, a dense DataMatrix cannot resolve. */
const MIN_EDGE = 200;
/** Never larger than this — huge regions cost frame rate for no accuracy gain. */
const MAX_EDGE = 480;

export interface ScanBox {
  width: number;
  height: number;
}

/**
 * A square decode region for the given viewfinder, clamped to sane bounds and
 * never exceeding the frame itself.
 */
export function squareScanBox(viewfinderWidth: number, viewfinderHeight: number): ScanBox {
  const shortest = Math.min(viewfinderWidth, viewfinderHeight);

  // A non-positive or absurd viewfinder (measured before layout settles) must
  // not produce a zero-sized box — that silently disables scanning entirely.
  if (!Number.isFinite(shortest) || shortest <= 0) {
    return { width: MIN_EDGE, height: MIN_EDGE };
  }

  const desired = Math.floor(shortest * EDGE_FRACTION);
  // Clamp upward first, then never exceed the frame: on a genuinely tiny
  // viewfinder the frame wins over MIN_EDGE, since a box larger than the video
  // cannot be scanned.
  const edge = Math.min(Math.max(desired, MIN_EDGE), MAX_EDGE, Math.floor(shortest));

  return { width: edge, height: edge };
}
