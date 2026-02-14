'use client';

/**
 * Enhanced StatCard Component - Advanced dashboard card with trends and loading states
 * Supports various data types, loading states, error handling, and trend indicators
 */

import { LucideIcon, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { memo, useCallback } from 'react';
import { cn } from '@/utils/cn';

// 🟢 WORKING: Enhanced stat card props interface
export interface EnhancedStatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  trend?: {
    direction: 'up' | 'down' | 'stable';
    percentage: number;
    label?: string;
  };
  subtitle?: string;
  description?: string;
  route?: string;
  onClick?: () => void;
  isLoading?: boolean;
  error?: string | null;
  className?: string;
  variant?: 'default' | 'compact' | 'detailed';
  showTrend?: boolean;
  formatValue?: (value: number | string) => string;
}

// 🟢 WORKING: Enhanced StatCard component with comprehensive features
const EnhancedStatCardComponent = ({
  title,
  value,
  icon: Icon,
  color,
  trend,
  subtitle,
  description,
  route,
  onClick,
  isLoading = false,
  error = null,
  className,
  variant = 'default',
  showTrend = true,
  formatValue,
}: EnhancedStatCardProps) => {
  const handleClick = useCallback(() => {
    if (error) return;
    if (onClick) {
      onClick();
    }
  }, [onClick, error]);

  // 🟢 WORKING: Format display value
  const displayValue = formatValue 
    ? formatValue(value) 
    : typeof value === 'number' 
      ? value.toLocaleString() 
      : value;

  // 🟢 WORKING: Get trend icon and color
  const getTrendIcon = () => {
    if (!trend) return null;
    
    switch (trend.direction) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      case 'stable':
        return <Minus className="w-4 h-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getTrendTextColor = () => {
    if (!trend) return 'text-muted-foreground';
    
    switch (trend.direction) {
      case 'up': return 'text-green-600';
      case 'down': return 'text-red-600';
      case 'stable': return 'text-muted-foreground';
      default: return 'text-muted-foreground';
    }
  };

  // 🟢 WORKING: Render loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-sm',
          'animate-pulse',
          variant === 'compact' ? 'p-4' : 'p-6',
          className
        )}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-3/4 mb-2"></div>
            {variant !== 'compact' && (
              <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-1/2"></div>
            )}
          </div>
          <div className="w-12 h-12 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        </div>

        <div className="space-y-2">
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-1/2"></div>
          {variant === 'detailed' && (
            <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-1/3"></div>
          )}
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Render error state
  if (error) {
    return (
      <div
        className={cn(
          'bg-red-500/10 border border-red-500/30 rounded-lg',
          variant === 'compact' ? 'p-4' : 'p-6',
          className
        )}
      >
        <div className="flex items-center space-x-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-medium">Error loading {title}</span>
        </div>
        <p className="text-xs text-red-400/80 mt-1 truncate">{error}</p>
      </div>
    );
  }

  // 🟢 WORKING: Card inner content (shared between Link and div wrappers)
  const cardClasses = cn(
    'group relative overflow-hidden bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-sm',
    'hover:shadow-md transition-all duration-200',
    (onClick || route) && !error && 'cursor-pointer hover:border-blue-500/50',
    variant === 'compact' && 'p-4',
    variant !== 'compact' && 'p-6',
    className
  );

  const cardContent = (
    <>
      {/* Top colored bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
        style={{ backgroundColor: color }}
      />

      {/* Card Content */}
      <div>
        {/* Header with icon and title */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h3 className={cn(
              'font-semibold text-[var(--ff-text-primary)] truncate',
              variant === 'compact' ? 'text-base' : 'text-lg'
            )}>
              {title}
            </h3>

            {subtitle && variant !== 'compact' && (
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1 leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>

          {/* Icon container */}
          <div
            className={cn(
              'flex-shrink-0 rounded-lg flex items-center justify-center ml-4',
              variant === 'compact' ? 'w-10 h-10' : 'w-12 h-12'
            )}
            style={{ backgroundColor: color }}
          >
            <Icon className={cn(
              'text-white',
              variant === 'compact' ? 'w-5 h-5' : 'w-6 h-6'
            )} />
          </div>
        </div>

        {/* Statistics */}
        <div className="space-y-2">
          {/* Main value */}
          <div className="flex items-baseline">
            <span className={cn(
              'font-bold text-[var(--ff-text-primary)]',
              variant === 'compact' ? 'text-2xl' : 'text-3xl'
            )}>
              {displayValue}
            </span>
          </div>

          {/* Trend and description */}
          {variant === 'detailed' && (
            <div className="space-y-1">
              {showTrend && trend && (
                <div className="flex items-center space-x-1">
                  {getTrendIcon()}
                  <span className={cn('text-sm font-medium', getTrendTextColor())}>
                    {trend.percentage > 0 ? '+' : ''}{trend.percentage.toFixed(1)}%
                    {trend.label && ` ${trend.label}`}
                  </span>
                </div>
              )}

              {description && (
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {description}
                </p>
              )}
            </div>
          )}

          {/* Compact trend display */}
          {variant !== 'detailed' && showTrend && trend && (
            <div className="flex items-center space-x-1">
              {getTrendIcon()}
              <span className={cn('text-xs font-medium', getTrendTextColor())}>
                {trend.percentage > 0 ? '+' : ''}{trend.percentage.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Hover effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-transparent group-hover:from-white/5 group-hover:to-transparent transition-all duration-200 pointer-events-none" />
    </>
  );

  // 🟢 WORKING: Use Link for route navigation (works in both Pages & App Router)
  if (route && !error) {
    return (
      <Link href={route} className={cn(cardClasses, 'block no-underline')} onClick={onClick}>
        {cardContent}
      </Link>
    );
  }

  // 🟢 WORKING: Use div for onClick-only or non-interactive cards
  return (
    <div className={cardClasses} onClick={handleClick}>
      {cardContent}
    </div>
  );
};

// 🟢 WORKING: Memoized export for performance
export const EnhancedStatCard = memo(EnhancedStatCardComponent);

// 🟢 WORKING: Stats grid component for dashboard layouts
interface StatsGridProps {
  cards: EnhancedStatCardProps[];
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

export const StatsGrid = memo(({ cards, columns = 3, className }: StatsGridProps) => {
  const getGridClass = () => {
    switch (columns) {
      case 2: return 'grid-cols-1 md:grid-cols-2';
      case 3: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
      case 4: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
      case 5: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';
      case 6: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6';
      default: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
    }
  };

  return (
    <div className={cn(
      'grid gap-6',
      getGridClass(),
      className
    )}>
      {cards.map((card, index) => (
        <EnhancedStatCard key={`${card.title}-${index}`} {...card} />
      ))}
    </div>
  );
});

StatsGrid.displayName = 'StatsGrid';