/**
 * AccessibleProgressBar
 *
 * WCAG 2.1 AA compliant progress bar.
 *
 * Implements:
 *   - role="progressbar"            (WCAG 4.1.2)
 *   - aria-valuenow/min/max         (WCAG 1.3.1)
 *   - aria-label OR aria-labelledby (WCAG 4.1.2 — one MUST be supplied)
 *   - aria-valuetext                (human-readable percentage)
 *   - Colour + text double-coding   (WCAG 1.4.1 — never colour alone)
 *
 * Usage:
 *   <ProgressBar value={60} label="Phase 2 progress" />
 *   <ProgressBar value={60} labelledById="phase-title" size="md" showLabel />
 *   <ProgressBar value={60} label="Stage" thresholds={STAGE_THRESHOLDS} />
 */

import { cn } from '@/lib/utils';

export interface ProgressBarThresholds {
  /** Below this ⇒ danger / red */
  warn: number;
  /** Above this ⇒ success / green; between warn–good ⇒ amber */
  good: number;
}

/** Prereq-style: red <50 %, amber <80 %, green ≥ 80 % */
export const PREREQ_THRESHOLDS: ProgressBarThresholds = { warn: 50, good: 80 };
/** Stage-style: red <25 %, amber <75 %, green ≥ 75 % */
export const STAGE_THRESHOLDS: ProgressBarThresholds = { warn: 25, good: 75 };

export interface ProgressBarProps {
  /** Current value 0–100. Clamped automatically. */
  value: number;
  /**
   * Visible/accessible label.
   * Required unless `labelledById` is provided.
   */
  label?: string;
  /** ID of an existing element that labels this bar (alternative to `label`). */
  labelledById?: string;
  /** Colour thresholds. Defaults to PREREQ_THRESHOLDS. */
  thresholds?: ProgressBarThresholds;
  /** Bar height preset. */
  size?: 'xs' | 'sm' | 'md';
  /** Render the percentage visibly below the bar. */
  showLabel?: boolean;
  className?: string;
  trackClassName?: string;
}

function getBarColor(value: number, t: ProgressBarThresholds): string {
  if (value === 0) return 'bg-gray-600';
  if (value < t.warn) return 'bg-red-500';
  if (value < t.good) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function getLabelColor(value: number, t: ProgressBarThresholds): string {
  if (value === 0) return 'text-gray-400';
  if (value < t.warn) return 'text-red-400';
  if (value < t.good) return 'text-amber-400';
  return 'text-emerald-400';
}

const HEIGHT: Record<NonNullable<ProgressBarProps['size']>, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2.5',
};

export function ProgressBar({
  value,
  label,
  labelledById,
  thresholds = PREREQ_THRESHOLDS,
  size = 'sm',
  showLabel = false,
  className,
  trackClassName,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const barColor = getBarColor(pct, thresholds);
  const labelColor = getLabelColor(pct, thresholds);

  return (
    <div className={cn('w-full', className)}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
        {...(label ? { 'aria-label': label } : {})}
        {...(labelledById ? { 'aria-labelledby': labelledById } : {})}
        className={cn(
          'w-full bg-gray-700 rounded-full overflow-hidden',
          HEIGHT[size],
          trackClassName,
        )}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>

      {showLabel && (
        <span className={cn('text-xs font-medium mt-0.5', labelColor)} aria-hidden="true">
          {pct}%
        </span>
      )}

      {/* Always expose percentage to screen readers, hidden visually when showLabel=false */}
      {!showLabel && <span className="sr-only">{pct}%</span>}
    </div>
  );
}

export default ProgressBar;
