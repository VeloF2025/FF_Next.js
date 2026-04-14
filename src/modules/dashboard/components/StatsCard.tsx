'use client';

import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/utils/cn';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    label: string;
  };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  className?: string;
}

const variantClasses = {
  default: {
    card: 'bg-[var(--ff-surface-primary)] border-[var(--ff-border-primary)]',
    icon: 'bg-neutral-100 text-neutral-600',
    value: 'text-[var(--ff-text-primary)]',
    title: 'text-[var(--ff-text-secondary)]',
  },
  primary: {
    card: 'bg-[var(--ff-surface-primary)] border-primary-200',
    icon: 'bg-primary-100 text-primary-600',
    value: 'text-[var(--ff-text-primary)]',
    title: 'text-[var(--ff-text-secondary)]',
  },
  success: {
    card: 'bg-[var(--ff-surface-primary)] border-success-200',
    icon: 'bg-success-100 text-success-600',
    value: 'text-[var(--ff-text-primary)]',
    title: 'text-[var(--ff-text-secondary)]',
  },
  warning: {
    card: 'bg-[var(--ff-surface-primary)] border-warning-200',
    icon: 'bg-warning-100 text-warning-600',
    value: 'text-[var(--ff-text-primary)]',
    title: 'text-[var(--ff-text-secondary)]',
  },
  error: {
    card: 'bg-[var(--ff-surface-primary)] border-error-200',
    icon: 'bg-error-100 text-error-600',
    value: 'text-[var(--ff-text-primary)]',
    title: 'text-[var(--ff-text-secondary)]',
  },
};

export function StatsCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  variant = 'default',
  className = '',
}: StatsCardProps) {
  const styles = variantClasses[variant];

  const formatValue = (val: string | number) => {
    if (typeof val === 'number') {
      if (val >= 1000000) {
        return `${(val / 1000000).toFixed(1)}M`;
      }
      if (val >= 1000) {
        return `${(val / 1000).toFixed(1)}K`;
      }
      return val.toLocaleString();
    }
    return val;
  };

  return (
    <div className={cn(
      'rounded-lg border p-6 shadow-sm hover:shadow-md transition-shadow duration-200',
      styles.card,
      className
    )}>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <p className={cn('text-sm font-medium', styles.title)}>
            {title}
          </p>
          <div className="flex items-baseline space-x-2">
            <p className={cn('text-2xl font-bold', styles.value)}>
              {formatValue(value)}
            </p>
            {trend && (
              <div className={cn(
                'flex items-center text-xs font-medium',
                trend.isPositive ? 'text-success-600' : 'text-error-600'
              )}>
                {trend.isPositive ? (
                  <TrendingUp className="w-3 h-3 mr-1" />
                ) : (
                  <TrendingDown className="w-3 h-3 mr-1" />
                )}
                <span>{Math.abs(trend.value)}%</span>
              </div>
            )}
          </div>
          {(description || trend?.label) && (
            <p className="text-xs text-[var(--ff-text-tertiary)]">
              {trend?.label || description}
            </p>
          )}
        </div>
        <div className={cn(
          'rounded-full p-3',
          styles.icon
        )}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}