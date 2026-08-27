/**
 * The knobs the vehicle-day fold turns, and what the caller must tell it about the window.
 *
 * Separated from the fold itself because these are DECISIONS, each carrying the measurement that
 * justifies it, and they are read far more often than the loop that consumes them. Every default
 * below was measured against production on 2026-08-25; none is a round number chosen for looking
 * tidy.
 */
import type { DayPosition } from './types';

/**
 * Positions per page for the incremental build.
 *
 * 5,000 is roughly four `cartrack/velocity` vehicle-days at that feed's measured 1,169 fixes/day:
 * large enough that an ordinary rebuild is one page, small enough to stay well inside one query's
 * memory. Exported because the batch-invariance sweep must include the production value, or it
 * proves nothing about production.
 */
export const DAY_FOLD_POSITION_BATCH_SIZE = 5_000;

export interface DayFoldOptions {
  /** Longer than this and the interval is counted toward duration but attributed to nothing. */
  maxAttributableIntervalSeconds: number;
  /**
   * Harsh events below this speed are discarded.
   *
   * Not optional tuning: every live `HARSH_BRAKING` sample carried speed = 6 km/h, and 19 of the
   * 20 g-derived braking events on the only vehicle reporting g were at <= 10 km/h. Without the
   * gate this counter is a report on one broken device.
   */
  harshMinSpeedKph: number;
  /** p99.9 of abs(linear_g) is 0.140; Cartrack's own firmware fires at 0.42-0.68. */
  harshLinearG: number;
  /** lateral_g is already an unsigned magnitude (min 0.000 over 237,419 rows). */
  harshLateralG: number;
}

/** What the caller knows about the window that the positions themselves cannot say. */
export interface DayFoldWindow {
  /**
   * The last position before the window opened, or null when there is none (or none was looked
   * up). Never derived from the batch -- see the module header.
   */
  leadIn?: DayPosition | null;
  /** ISO instant the window closes. Defaults to the last fix folded, which claims no tail gap. */
  windowEnd?: string | null;
}

export const DEFAULT_DAY_FOLD_OPTIONS: DayFoldOptions = {
  maxAttributableIntervalSeconds: 300,
  harshMinSpeedKph: 20,
  harshLinearG: 0.35,
  harshLateralG: 0.35,
};
