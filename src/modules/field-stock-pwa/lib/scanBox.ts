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
 * The fix is not "make it square" — that was the first attempt, and on a
 * wide-but-short viewfinder (e.g. 320x280) a square throws away width the frame
 * was offering, ending up NARROWER than the 300px it replaced and regressing
 * the 1D barcodes it was supposed to leave alone.
 *
 * What each format actually needs:
 *   1D (Code128 on a unit label) — WIDTH. The old region gave 300.
 *   2D (DataMatrix on a carton)  — HEIGHT as well. The old region gave 140.
 *
 * So take as much of the frame as sensible on EACH axis independently, capped.
 * That is at least as good as the old region in both dimensions on every
 * viewfinder large enough to offer it, and clamps to the frame when it is not —
 * a box larger than the video cannot be scanned at all.
 *
 * MEASURED, not assumed (2026-08-21, real carton photo through zxing):
 *
 *   region 300x140, symbol 285x260 visible as 285x140 : FAILS   <- the old bug
 *   region 300x260, symbol 285x260 filling it exactly  : FAILS
 *   region 300x300, same symbol with ~20px of margin   : DECODES
 *
 * The second row is the one worth knowing. A DataMatrix needs a QUIET ZONE: a
 * symbol that fills the decode region edge to edge fails even though every
 * module of it is visible. So the region being merely big enough is not enough —
 * it has to be bigger than the symbol as the user frames it. That is why the
 * scanner hint tells the storeman to leave space around the code rather than to
 * fill the frame, which was the advice this file originally shipped with.
 *
 * A complete, well-lit symbol decodes even at 140px when it is not cropped, so
 * region size alone was never the whole story — cropping and quiet zone are.
 */

/** Fraction of each viewfinder edge the decode region should span. */
const EDGE_FRACTION = 0.9;
/**
 * Target floor, and the reason for it: the region this replaced was 300px WIDE.
 * A 1D barcode needs width, so going below 300 would trade a 2D fix for a 1D
 * regression. On a 350px viewfinder EDGE_FRACTION alone gives 280 — narrower
 * than before — so the floor, not the fraction, is what protects 1D scanning.
 *
 * It is a target, not a guarantee: a viewfinder smaller than this is clamped
 * down to the frame below, because a box larger than the video cannot be
 * scanned at all.
 */
const MIN_EDGE = 300;
/**
 * Height target. The old region gave 2D symbols only 140px, which is what made
 * a carton label unreadable in live video while a still photo decoded it.
 */
const MIN_HEIGHT = 260;
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
export function scanRegionFor(viewfinderWidth: number, viewfinderHeight: number): ScanBox {
  return {
    width: edgeFor(viewfinderWidth, viewfinderHeight, MIN_EDGE),
    height: edgeFor(viewfinderHeight, viewfinderWidth, MIN_HEIGHT),
  };
}

/**
 * One axis of the decode region.
 *
 * `fallback` is the OTHER axis, used only when this one is unmeasurable — if a
 * real dimension exists it must still bound the box, because falling back to a
 * constant beside a genuinely small frame produces a box bigger than the video.
 */
function edgeFor(dimension: number, fallback: number, target: number): number {
  const frame = Number.isFinite(dimension) && dimension > 0
    ? dimension
    : (Number.isFinite(fallback) && fallback > 0 ? fallback : 0);

  // Nothing measurable at all: a zero-sized box silently disables scanning, so
  // return the target and let html5-qrcode clamp it against the real video.
  if (frame === 0) return target;

  const desired = Math.floor(frame * EDGE_FRACTION);
  // Reach the target where the frame allows it; never exceed the frame.
  return Math.min(Math.max(desired, target), MAX_EDGE, Math.floor(frame));
}
