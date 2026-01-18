/**
 * ReportCard - Reusable summary stat card with trend indicator
 *
 * Purpose: Display key metrics with optional trend sparkline and change indicator
 * Status: WORKING - Core component for reporting dashboard
 *
 * NLNH Confidence: HIGH
 */

'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

export type ReportCardColor =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'orange'
  | 'purple'
  | 'gray'
  | 'cyan'
  | 'pink';

export type TrendDirection = 'up' | 'down' | 'stable';

export interface ReportCardProps {
  /** Card title */
  title: string;
  /** Main value to display */
  value: number | string;
  /** Card color theme */
  color?: ReportCardColor;
  /** Optional subtitle */
  subtitle?: string;
  /** Trend direction indicator */
  trend?: TrendDirection;
  /** Trend change value (e.g., "+12%", "-5") */
  trendValue?: string;
  /** Whether trend is good (green) or bad (red) - overrides default */
  trendIsPositive?: boolean;
  /** Optional icon to display */
  icon?: ReactNode;
  /** Click handler for drill-down */
  onClick?: () => void;
  /** Loading state */
  isLoading?: boolean;
  /** Small variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show progress bar (0-100) */
  progress?: number;
  /** Target value for progress (shows as dotted line) */
  target?: number;
}

const colorClasses: Record<ReportCardColor, string> = {
  blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  yellow: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
  purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  gray: 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700',
  cyan: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
  pink: 'bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-800',
};

const textColorClasses: Record<ReportCardColor, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-yellow-600 dark:text-yellow-400',
  red: 'text-red-600 dark:text-red-400',
  orange: 'text-orange-600 dark:text-orange-400',
  purple: 'text-purple-600 dark:text-purple-400',
  gray: 'text-gray-600 dark:text-gray-400',
  cyan: 'text-cyan-600 dark:text-cyan-400',
  pink: 'text-pink-600 dark:text-pink-400',
};

const progressColorClasses: Record<ReportCardColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  gray: 'bg-gray-500',
  cyan: 'bg-cyan-500',
  pink: 'bg-pink-500',
};

export function ReportCard({
  title,
  value,
  color = 'gray',
  subtitle,
  trend,
  trendValue,
  trendIsPositive,
  icon,
  onClick,
  isLoading,
  size = 'md',
  progress,
  target,
}: ReportCardProps) {
  const sizeClasses = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };

  const valueSizeClasses = {
    sm: 'text-xl',
    md: 'text-2xl',
    lg: 'text-3xl',
  };

  // Determine if trend is positive based on direction and override
  const isTrendPositive =
    trendIsPositive !== undefined
      ? trendIsPositive
      : trend === 'up';

  const TrendIcon =
    trend === 'up'
      ? TrendingUp
      : trend === 'down'
        ? TrendingDown
        : Minus;

  if (isLoading) {
    return (
      <div
        className={`rounded-lg border ${colorClasses[color]} ${sizeClasses[size]} animate-pulse`}
      >
        <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24 mb-2" />
        <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-16" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border ${colorClasses[color]} ${sizeClasses[size]} ${
        onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Header with title and icon */}
      <div className="flex items-center justify-between mb-1">
        <div className={`text-sm font-medium ${textColorClasses[color]} opacity-75`}>
          {title}
        </div>
        {icon && (
          <div className={`${textColorClasses[color]} opacity-60`}>{icon}</div>
        )}
      </div>

      {/* Value and trend */}
      <div className="flex items-end justify-between">
        <div className={`${valueSizeClasses[size]} font-bold ${textColorClasses[color]}`}>
          {value}
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-sm ${
              isTrendPositive
                ? 'text-green-600 dark:text-green-400'
                : trend === 'stable'
                  ? 'text-gray-500 dark:text-gray-400'
                  : 'text-red-600 dark:text-red-400'
            }`}
          >
            <TrendIcon className="h-4 w-4" />
            {trendValue && <span className="font-medium">{trendValue}</span>}
          </div>
        )}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div className={`text-xs ${textColorClasses[color]} opacity-60 mt-1`}>
          {subtitle}
        </div>
      )}

      {/* Progress bar */}
      {progress !== undefined && (
        <div className="mt-3">
          <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full ${progressColorClasses[color]} rounded-full transition-all duration-300`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
            {target !== undefined && (
              <div
                className="absolute top-0 h-full w-0.5 bg-gray-500 dark:bg-gray-400"
                style={{ left: `${Math.min(100, Math.max(0, target))}%` }}
                title={`Target: ${target}%`}
              />
            )}
          </div>
          <div className="flex justify-between mt-1">
            <span className={`text-xs ${textColorClasses[color]} opacity-60`}>
              {progress.toFixed(0)}%
            </span>
            {target !== undefined && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Target: {target}%
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ReportCardGrid - Grid container for report cards
 */
export interface ReportCardGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
}

export function ReportCardGrid({ children, columns = 4 }: ReportCardGridProps) {
  const gridCols = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
  };

  return <div className={`grid ${gridCols[columns]} gap-4`}>{children}</div>;
}

export default ReportCard;
