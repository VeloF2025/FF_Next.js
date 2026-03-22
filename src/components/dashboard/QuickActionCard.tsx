/**
 * QuickActionCard Component - Redesigned quick action cards matching StatCard design system
 */

import { LucideIcon } from 'lucide-react';
import { useRouter } from 'next/router';
import { memo, useCallback } from 'react';
import { cn } from '@/utils/cn';

interface QuickActionCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  route?: string;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const QuickActionCardComponent = ({
  title,
  description,
  icon: Icon,
  color,
  route,
  onClick,
  className,
  style
}: QuickActionCardProps) => {
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
        'ff-quick-action-card group relative overflow-hidden bg-[var(--ff-bg-secondary)] rounded-xl border border-[var(--ff-border-light)] shadow-sm hover:shadow-lg hover:border-blue-500/50 transition-all duration-300 cursor-pointer h-[180px]',
        className
      )}
      style={{
        '--action-color': color,
        ...style
      } as React.CSSProperties}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`${title}: ${description}`}
      aria-describedby={`action-description-${title.replace(/\s+/g, '-').toLowerCase()}`}
    >
      {/* Top colored accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl"
        style={{ backgroundColor: color }}
      />

      {/* Card Content */}
      <div className="p-6 h-full flex flex-col">
        {/* Vertical layout with icon at top and content below */}
        <div className="flex flex-col items-center text-center space-y-4 flex-grow">
          {/* Icon container */}
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ backgroundColor: color }}
          >
            <Icon className="w-6 h-6 text-white" />
          </div>

          {/* Content below icon - constrained to prevent overflow */}
          <div className="w-full flex-grow flex flex-col justify-center">
            <h4 className="text-base font-semibold text-[var(--ff-text-primary)] mb-2 line-clamp-1">
              {title}
            </h4>
            <p
              className="text-xs text-[var(--ff-text-secondary)] leading-relaxed line-clamp-2"
              id={`action-description-${title.replace(/\s+/g, '-').toLowerCase()}`}
            >
              {description}
            </p>
          </div>

          {/* Action indicator at bottom */}
          <div className="flex-shrink-0">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-110"
              style={{ backgroundColor: color + '20' }}
            >
              <svg
                className="w-3 h-3 transition-colors duration-200"
                style={{ color: color }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Hover effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-transparent group-hover:from-white/5 group-hover:to-transparent transition-all duration-200 pointer-events-none" />
    </div>
  );
};

// Export memoized version for performance
export const QuickActionCard = memo(QuickActionCardComponent);