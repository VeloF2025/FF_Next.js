/**
 * DRLookup Component - DR number lookup field
 *
 * 🟢 WORKING: Production-ready DR lookup component
 *
 * Features:
 * - Search DR numbers from SOW module
 * - Auto-populate ticket fields from DR data
 * - Loading states during lookup
 * - Error handling for invalid DRs
 * - Real-time validation
 */

'use client';

import React, { useState } from 'react';
import { Search, Loader2, CheckCircle2, AlertTriangle, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DRLookupData } from '../../types/ticket';

interface DRLookupProps {
  /** Current DR number value */
  value?: string;
  /** Callback when DR is selected and data is available */
  onDRSelected: (drNumber: string, drData: DRLookupData | null) => void;
  /** Callback when DR number changes */
  onChange?: (drNumber: string) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Custom className */
  className?: string;
}

/**
 * 🟢 WORKING: DR lookup component
 */
export function DRLookup({
  value = '',
  onDRSelected,
  onChange,
  disabled = false,
  className,
}: DRLookupProps) {
  const [drNumber, setDRNumber] = useState(value);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drData, setDrData] = useState<DRLookupData | null>(null);

  // 🟢 WORKING: Perform DR lookup
  const handleLookup = async () => {
    if (!drNumber.trim()) {
      setError('Please enter a DR number');
      return;
    }

    setIsLoading(true);
    setError(null);
    setDrData(null);

    try {
      const response = await fetch(`/api/ticketing/dr-lookup/${encodeURIComponent(drNumber)}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to lookup DR number');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'DR not found');
      }

      setDrData(result.data);
      onDRSelected(drNumber, result.data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to lookup DR number';
      setError(errorMessage);
      setDrData(null);
      onDRSelected(drNumber, null);
    } finally {
      setIsLoading(false);
    }
  };

  // 🟢 WORKING: Handle input change
  const handleInputChange = (newValue: string) => {
    setDRNumber(newValue);
    setError(null);
    setDrData(null);
    if (onChange) {
      onChange(newValue);
    }
  };

  // 🟢 WORKING: Handle Enter key
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLookup();
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      {/* Input Field */}
      <div className="relative">
        <input
          type="text"
          value={drNumber}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="e.g., DR12345"
          disabled={disabled || isLoading}
          className={cn(
            'w-full pl-4 pr-24 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-red-500/50 focus:ring-red-500/50',
            drData && 'border-green-500/50 focus:ring-green-500/50'
          )}
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={disabled || isLoading || !drNumber.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Lookup
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Success Message with DR Data */}
      {drData && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-start gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-400 mb-1">DR Found</p>
              <p className="text-xs text-green-300">The following data will be used to populate the ticket</p>
            </div>
          </div>

          {/* DR Data Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {drData.pole_number && (
              <div>
                <span className="text-green-700 dark:text-green-300/70">Pole:</span>{' '}
                <span className="text-green-800 dark:text-green-200 font-mono">{drData.pole_number}</span>
              </div>
            )}
            {drData.pon_number && (
              <div>
                <span className="text-green-700 dark:text-green-300/70">PON:</span>{' '}
                <span className="text-green-800 dark:text-green-200 font-mono">{drData.pon_number}</span>
              </div>
            )}
            {drData.zone_number && (
              <div>
                <span className="text-green-700 dark:text-green-300/70">Zone:</span>{' '}
                <span className="text-green-800 dark:text-green-200 font-mono">{drData.zone_number}</span>
              </div>
            )}
            {drData.project_name && (
              <div className="col-span-2">
                <span className="text-green-700 dark:text-green-300/70">Project:</span>{' '}
                <span className="text-green-800 dark:text-green-200">{drData.project_name}</span>
              </div>
            )}
            {drData.address && (
              <div className="col-span-2 flex items-start gap-1">
                <MapPin className="w-3 h-3 text-green-700 dark:text-green-300/70 mt-0.5 flex-shrink-0" />
                <span className="text-green-800 dark:text-green-200">{drData.address}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
