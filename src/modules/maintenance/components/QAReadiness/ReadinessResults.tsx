/**
 * ReadinessResults Component - Display detailed QA readiness check results
 *
 * 🟢 WORKING: Production-ready readiness results display component
 *
 * Features:
 * - Show all individual check results (pass/fail)
 * - Display failed checks with reasons
 * - Show expected vs actual values
 * - Progress bar for passed checks
 * - Check timestamp
 * - Color-coded pass/fail indicators
 */

'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QAReadinessCheck, QAReadinessFailedCheck } from '../../types/verification';

interface ReadinessResultsProps {
  /** The readiness check result to display */
  check: QAReadinessCheck;
  /** Show compact view */
  compact?: boolean;
}

/**
 * Check item interface for rendering
 */
interface CheckItem {
  name: string;
  label: string;
  passed: boolean | null;
  failureInfo?: QAReadinessFailedCheck;
}

/**
 * 🟢 WORKING: Get all check items from readiness check
 */
function getCheckItems(check: QAReadinessCheck): CheckItem[] {
  const failedChecksMap = new Map(
    (check.failed_checks || []).map((fc) => [fc.check_name, fc])
  );

  return [
    {
      name: 'photos_exist',
      label: 'Photos Uploaded',
      passed: check.photos_exist,
      failureInfo: failedChecksMap.get('photos_exist'),
    },
    {
      name: 'dr_populated',
      label: 'DR Number Recorded',
      passed: check.dr_populated,
      failureInfo: failedChecksMap.get('dr_populated'),
    },
    {
      name: 'pole_populated',
      label: 'Pole Number Recorded',
      passed: check.pole_populated,
      failureInfo: failedChecksMap.get('pole_populated'),
    },
    {
      name: 'pon_populated',
      label: 'PON Number Recorded',
      passed: check.pon_populated,
      failureInfo: failedChecksMap.get('pon_populated'),
    },
    {
      name: 'zone_populated',
      label: 'Zone Information Recorded',
      passed: check.zone_populated,
      failureInfo: failedChecksMap.get('zone_populated'),
    },
    {
      name: 'ont_serial_recorded',
      label: 'ONT Details Recorded',
      passed: check.ont_serial_recorded,
      failureInfo: failedChecksMap.get('ont_serial_recorded'),
    },
    {
      name: 'ont_rx_recorded',
      label: 'ONT RX Power Level Recorded',
      passed: check.ont_rx_recorded,
      failureInfo: failedChecksMap.get('ont_rx_recorded'),
    },
    {
      name: 'platforms_aligned',
      label: 'Platform Data Aligned',
      passed: check.platforms_aligned,
      failureInfo: failedChecksMap.get('platforms_aligned'),
    },
  ];
}

/**
 * 🟢 WORKING: Calculate progress statistics
 */
function calculateProgress(checkItems: CheckItem[]): {
  total: number;
  passed: number;
  failed: number;
  percentage: number;
} {
  const total = checkItems.length;
  const passed = checkItems.filter((item) => item.passed === true).length;
  const failed = total - passed;
  const percentage = Math.round((passed / total) * 100);

  return { total, passed, failed, percentage };
}

/**
 * 🟢 WORKING: Format check timestamp
 */
function formatCheckTime(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 🟢 WORKING: Readiness results display component
 */
export function ReadinessResults({ check, compact = false }: ReadinessResultsProps) {
  const checkItems = getCheckItems(check);
  const progress = calculateProgress(checkItems);

  return (
    <div className="space-y-4">
      {/* Overall status */}
      <div className="flex items-center justify-between">
        <div>
          {check.passed ? (
            <div className="flex items-center text-green-400">
              <CheckCircle2 className="w-5 h-5 mr-2" />
              <span className="font-semibold">All Checks Passed</span>
            </div>
          ) : (
            <div className="flex items-center text-red-400">
              <XCircle className="w-5 h-5 mr-2" />
              <span className="font-semibold">
                {progress.failed} Check{progress.failed !== 1 ? 's' : ''} Failed
              </span>
            </div>
          )}
          <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
            Checked on {formatCheckTime(check.checked_at)}
          </p>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{progress.percentage}%</div>
          <div className="text-xs text-[var(--ff-text-secondary)]">
            {progress.passed} of {progress.total} checks passed
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2 overflow-hidden">
        <div
          className={cn(
            'h-2 rounded-full transition-all duration-500',
            check.passed
              ? 'bg-gradient-to-r from-green-500 to-emerald-500'
              : progress.percentage > 50
              ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
              : 'bg-gradient-to-r from-red-500 to-red-600'
          )}
          style={{ width: `${progress.percentage}%` }}
        />
      </div>

      {/* Individual check results */}
      <div className={cn('space-y-2', compact && 'space-y-1')}>
        {checkItems.map((item) => (
          <div
            key={item.name}
            className={cn(
              'flex items-start p-3 rounded-lg border transition-all',
              item.passed
                ? 'bg-green-500/5 border-green-500/20'
                : item.passed === false
                ? 'bg-red-500/10 border-red-500/20'
                : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]',
              compact && 'p-2'
            )}
          >
            <div className="flex-shrink-0 mt-0.5">
              {item.passed ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : item.passed === false ? (
                <XCircle className="w-5 h-5 text-red-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              )}
            </div>

            <div className="ml-3 flex-1">
              <div className="flex items-center justify-between">
                <p
                  className={cn(
                    'font-medium',
                    item.passed
                      ? 'text-green-400'
                      : item.passed === false
                      ? 'text-red-400'
                      : 'text-[var(--ff-text-secondary)]',
                    compact && 'text-sm'
                  )}
                >
                  {item.label}
                </p>
                {item.name === 'photos_exist' && check.photos_count !== null && (
                  <span className="text-xs text-[var(--ff-text-secondary)]">
                    {check.photos_count}/{check.photos_required_count || 3} photos
                  </span>
                )}
              </div>

              {/* Failure details */}
              {item.failureInfo && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-red-300">{item.failureInfo.reason}</p>
                  {(item.failureInfo.expected !== undefined || item.failureInfo.actual !== undefined) && (
                    <div className="flex items-center space-x-4 text-xs text-[var(--ff-text-secondary)]">
                      {item.failureInfo.expected !== undefined && (
                        <span>
                          Expected: <span className="text-green-400">{item.failureInfo.expected}</span>
                        </span>
                      )}
                      {item.failureInfo.actual !== undefined && (
                        <span>
                          Actual: <span className="text-red-400">{item.failureInfo.actual}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer summary */}
      {!compact && check.passed && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-sm text-green-400 text-center">
            ✓ All requirements verified. This ticket is ready for QA review.
          </p>
        </div>
      )}

      {!compact && !check.passed && progress.failed > 0 && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400 text-center">
            Please resolve the {progress.failed} failed check{progress.failed !== 1 ? 's' : ''} before proceeding to QA.
          </p>
        </div>
      )}
    </div>
  );
}
