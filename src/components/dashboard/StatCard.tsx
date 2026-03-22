/**
 * StatCard Component - Dashboard statistics card matching the original Angular design
 */

import { LucideIcon } from 'lucide-react';
import { useRouter } from 'next/router';
import { memo, useCallback } from 'react';
import { cn } from '@/utils/cn';

interface StatCardProps {
  title: string;
  subtitle: string;
  value: string | number;
  subValue: string;
  icon: LucideIcon;
  color: string;
  route?: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  onClick?: (() => void) | undefined;
}

const StatCardComponent = ({
  title,
  subtitle,
  value,
  subValue,
  icon: Icon,
  color,
  route,
  className,
  style,
  onClick
}: StatCardProps) => {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
    } else if (route) {
      router.push(route);
    }
  }, [onClick, route, router]);

  return (
    <div
      className={cn(
        'ff-stat-card group relative overflow-hidden bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer hover:border-blue-500/50',
        className
      )}
      style={{
        '--stat-color': color,
        ...style
      } as React.CSSProperties}
      onClick={handleClick}
    >
      {/* Top colored bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
        style={{ backgroundColor: color }}
      />

      {/* Card Content */}
      <div className="p-6">
        {/* Header with icon and title */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">
              {title}
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)] leading-relaxed">
              {subtitle}
            </p>
          </div>

          {/* Icon container */}
          <div
            className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ml-4"
            style={{ backgroundColor: color }}
          >
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Statistics */}
        <div className="space-y-2">
          {/* Main value */}
          <div className="flex items-baseline">
            <span className="text-3xl font-bold text-[var(--ff-text-primary)]">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
          </div>

          {/* Sub value */}
          <p className="text-sm font-medium text-[var(--ff-text-secondary)]">
            {subValue}
          </p>
        </div>
      </div>

      {/* Hover effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-transparent group-hover:from-white/5 group-hover:to-transparent transition-all duration-200 pointer-events-none" />
    </div>
  );
};

// Export memoized version for performance
export const StatCard = memo(StatCardComponent);