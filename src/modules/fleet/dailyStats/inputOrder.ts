/**
 * The fold's input contract: ascending, and no fix twice.
 *
 * Both refusals exist because the alternative is silent. Out-of-order input mis-measures every gap
 * it touches, and a re-fed fix inflates `position_count` while contributing a zero-length interval
 * to nothing at all -- neither produces an error, both produce a plausible row.
 *
 * The duplicate test cannot be "same timestamp". A fix is not identified by its instant: 164
 * (vehicle, recorded_at) groups over 7 days of production hold more than one row, on all seven
 * `cartrack/velocity` vehicles, with distinct `provider_event_id`s at the same instant and in one
 * sampled pair disagreeing about ignition. Refusing an equal timestamp would throw on ordinary
 * data every day. Refusing a repeated ID at that instant catches the real hazard instead -- a
 * watermark read as `recorded_at >=` rather than `>`, which re-feeds the boundary fix.
 */
import type { DayPosition } from './types';

/**
 * Tracks the IDs seen at one instant, so a genuine tie is admitted and a repeat is refused.
 *
 * The set is cleared the moment the clock moves on, so it is bounded by the number of fixes
 * sharing a single instant -- two or three in the observed data -- and not by the window. That
 * keeps it O(1) over a month-long backfill.
 */
export interface InstantDeduper {
  /** Throws if `p` is out of order or is a fix already folded at this instant. */
  admit(p: DayPosition, curMs: number, prevMs: number, hasPrev: boolean): void;
  /** Seeds the set from a lead-in, which occupies the previous instant without being folded. */
  seed(p: DayPosition): void;
}

export function createInstantDeduper(): InstantDeduper {
  let idsAtPrevMs = new Set<string>();
  const idOf = (p: DayPosition) => p.providerEventId ?? '';

  return {
    seed(p) {
      idsAtPrevMs = new Set([idOf(p)]);
    },
    admit(p, curMs, prevMs, hasPrev) {
      if (!Number.isFinite(curMs)) {
        throw new Error(`dayFold: unparseable recordedAt ${p.recordedAt}`);
      }
      if (hasPrev && curMs < prevMs) {
        throw new Error('dayFold: positions must be supplied in ascending recordedAt order');
      }
      if (hasPrev && curMs === prevMs) {
        const key = idOf(p);
        if (idsAtPrevMs.has(key)) {
          throw new Error(
            'dayFold: the same fix was supplied twice -- batches must not overlap, and a watermark '
            + `must be exclusive (recorded_at > watermark). Repeated at ${p.recordedAt}.`,
          );
        }
        idsAtPrevMs.add(key);
        return;
      }
      // The clock moved on, so nothing seen before can be a duplicate of anything to come.
      idsAtPrevMs = new Set([idOf(p)]);
    },
  };
}
