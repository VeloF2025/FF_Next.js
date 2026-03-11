/**
 * FaultCauseSelector Component - Fault cause selection with details
 *
 * 🟢 WORKING: Production-ready fault attribution component
 *
 * Features:
 * - 7 fault cause options (Workmanship, Material Failure, etc.)
 * - Contractor liability indicator
 * - Required details field
 * - Examples and descriptions
 * - Color-coded by fault type
 * - Validation support
 * - Character count for details
 * - Responsive design
 */

'use client';

import React, { useCallback } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { FaultCause } from '../../types/ticket';
import {
  FAULT_CAUSE_OPTIONS,
  getFaultCauseMetadata,
  isContractorLiable,
} from '../../constants/faultCauses';
import { cn } from '@/lib/utils';

interface FaultCauseSelectorProps {
  /** Selected fault cause */
  value: FaultCause | null;
  /** Fault cause details */
  details: string;
  /** Callback when selection changes */
  onChange: (data: { fault_cause: FaultCause | null; fault_cause_details: string }) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Whether fault cause is required */
  required?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Show character count for details */
  showCharacterCount?: boolean;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Fault cause selector with details input
 */
export function FaultCauseSelector({
  value,
  details,
  onChange,
  disabled = false,
  required = false,
  error = null,
  showCharacterCount = true,
  compact = false,
}: FaultCauseSelectorProps) {
  // 🟢 WORKING: Handle fault cause selection
  const handleCauseChange = useCallback(
    (newCause: FaultCause | null) => {
      onChange({
        fault_cause: newCause,
        fault_cause_details: details,
      });
    },
    [onChange, details]
  );

  // 🟢 WORKING: Handle details input change
  const handleDetailsChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({
        fault_cause: value,
        fault_cause_details: e.target.value,
      });
    },
    [onChange, value]
  );

  // 🟢 WORKING: Get color class for fault cause
  const getColorClass = (cause: FaultCause): string => {
    const metadata = getFaultCauseMetadata(cause);
    const colorMap: Record<string, string> = {
      error: 'text-red-400 bg-red-500/10 border-red-500/20',
      warning: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
      info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
      success: 'text-green-400 bg-green-500/10 border-green-500/20',
      default: 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]',
    };
    return colorMap[metadata.color] || colorMap.default;
  };

  return (
    <div className={cn('space-y-4', compact && 'space-y-2')}>
      {/* Fault Cause Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
          Fault Cause {required && <span className="text-red-400">*</span>}
        </label>

        <div className="relative">
          <select
            role="combobox"
            value={value || ''}
            onChange={(e) => handleCauseChange(e.target.value as FaultCause || null)}
            disabled={disabled}
            required={required}
            className={cn(
              'w-full px-4 py-3 bg-[var(--ff-bg-secondary)] border rounded-lg',
              'text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]',
              'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-all duration-200',
              error ? 'border-red-500/50' : 'border-[var(--ff-border-light)]',
              compact && 'py-2 text-sm'
            )}
          >
            <option value="">Select fault cause...</option>
            {FAULT_CAUSE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-2 mt-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Selected Cause Details */}
      {value && (
        <div className={cn(
          'p-4 rounded-lg border',
          getColorClass(value),
          compact && 'p-3'
        )}>
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex-1">
              <h4 className="font-semibold text-base mb-1">
                {getFaultCauseMetadata(value).label}
              </h4>
              <p className="text-sm opacity-90">
                {getFaultCauseMetadata(value).description}
              </p>
            </div>

            {/* Contractor Liability Indicator */}
            <div className={cn(
              'px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 flex-shrink-0',
              isContractorLiable(value)
                ? 'bg-red-500/20 text-red-300'
                : 'bg-green-500/20 text-green-300'
            )}>
              {isContractorLiable(value) ? (
                <>
                  <AlertCircle className="w-3 h-3" />
                  <span>Contractor Liable</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Not Contractor Liable</span>
                </>
              )}
            </div>
          </div>

          {/* Examples */}
          {!compact && (
            <div className="mt-3 pt-3 border-t border-current/10">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-60" />
                <div className="flex-1">
                  <p className="text-xs font-medium opacity-80 mb-1">Common Examples:</p>
                  <ul className="text-xs opacity-70 space-y-0.5">
                    {getFaultCauseMetadata(value).examples.slice(0, 3).map((example, idx) => (
                      <li key={idx}>• {example}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Details Input (only shown when cause selected) */}
      {value && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
            Fault Details {required && <span className="text-red-400">*</span>}
          </label>

          <div className="relative">
            <textarea
              value={details}
              onChange={handleDetailsChange}
              disabled={disabled}
              required={required}
              placeholder="Describe the fault in detail (e.g., specific location, what failed, observations)..."
              rows={compact ? 3 : 4}
              className={cn(
                'w-full px-4 py-3 bg-[var(--ff-bg-secondary)] border rounded-lg',
                'text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]',
                'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-all duration-200 resize-none',
                error ? 'border-red-500/50' : 'border-[var(--ff-border-light)]',
                compact && 'py-2 text-sm'
              )}
            />

            {/* Character Count */}
            {showCharacterCount && (
              <div className="absolute bottom-2 right-2 text-xs text-[var(--ff-text-tertiary)]">
                {details.length}
              </div>
            )}
          </div>

          <p className="text-xs text-[var(--ff-text-tertiary)]">
            Provide specific details to help identify root cause and prevent recurrence
          </p>
        </div>
      )}
    </div>
  );
}
