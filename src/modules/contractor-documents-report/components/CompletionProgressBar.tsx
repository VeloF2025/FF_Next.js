/**
 * Completion Progress Bar Component
 *
 * Visual progress indicator for document completion percentage
 */

import React from 'react';
import { getProgressBarColor } from '../utils/completenessCalculator';

interface CompletionProgressBarProps {
  percentage: number;
  showLabel?: boolean;
  height?: 'sm' | 'md' | 'lg';
}

export default function CompletionProgressBar({
  percentage,
  showLabel = true,
  height = 'md',
}: CompletionProgressBarProps) {
  const barColor = getProgressBarColor(percentage);

  const heightClasses = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4',
  };

  return (
    <div className="w-full">
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Document Completion</span>
          <span className="font-semibold text-foreground">{percentage}%</span>
        </div>
      )}
      <div className={`w-full bg-secondary rounded-full overflow-hidden ${heightClasses[height]}`}>
        <div
          className={`${barColor} ${heightClasses[height]} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
