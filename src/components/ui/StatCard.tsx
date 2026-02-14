/**
 * StatCard - Unified stat card component
 *
 * Following FibreFlow UI/UX Specification:
 * - Icon on RIGHT side (consistent across all pages)
 * - Dark theme background: #1a1d23
 * - No colored left borders (clean look)
 * - Consistent spacing and typography
 *
 * @see docs/UI_UX_SPECIFICATION.md
 */

import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

// Preset color schemes for common stat types
export const STAT_CARD_COLORS = {
  // Counts & Totals
  total: { iconBg: 'bg-blue-500/20', iconColor: 'text-blue-400' },
  count: { iconBg: 'bg-blue-500/20', iconColor: 'text-blue-400' },

  // Success states
  active: { iconBg: 'bg-green-500/20', iconColor: 'text-green-400' },
  success: { iconBg: 'bg-green-500/20', iconColor: 'text-green-400' },
  completed: { iconBg: 'bg-green-500/20', iconColor: 'text-green-400' },
  approved: { iconBg: 'bg-green-500/20', iconColor: 'text-green-400' },

  // Warning states
  pending: { iconBg: 'bg-yellow-500/20', iconColor: 'text-yellow-400' },
  warning: { iconBg: 'bg-yellow-500/20', iconColor: 'text-yellow-400' },
  draft: { iconBg: 'bg-yellow-500/20', iconColor: 'text-yellow-400' },

  // Error states
  error: { iconBg: 'bg-red-500/20', iconColor: 'text-red-400' },
  critical: { iconBg: 'bg-red-500/20', iconColor: 'text-red-400' },
  overdue: { iconBg: 'bg-red-500/20', iconColor: 'text-red-400' },

  // Financial
  financial: { iconBg: 'bg-purple-500/20', iconColor: 'text-purple-400' },
  value: { iconBg: 'bg-purple-500/20', iconColor: 'text-purple-400' },

  // Progress
  progress: { iconBg: 'bg-cyan-500/20', iconColor: 'text-cyan-400' },
  inProgress: { iconBg: 'bg-cyan-500/20', iconColor: 'text-cyan-400' },

  // Info
  info: { iconBg: 'bg-indigo-500/20', iconColor: 'text-indigo-400' },

  // Orange (for sent/shipping)
  sent: { iconBg: 'bg-orange-500/20', iconColor: 'text-orange-400' },
  shipping: { iconBg: 'bg-orange-500/20', iconColor: 'text-orange-400' },
} as const;

export type StatCardColorType = keyof typeof STAT_CARD_COLORS;

export interface StatCardProps {
  /** Card label/title */
  label: string;
  /** Main value to display */
  value: string | number;
  /** Icon component from lucide-react */
  icon: LucideIcon;
  /** Preset color type or custom colors */
  colorType?: StatCardColorType;
  /** Custom icon background class (overrides colorType) */
  iconBgColor?: string;
  /** Custom icon color class (overrides colorType) */
  iconColor?: string;
  /** Subtitle text below value */
  subtitle?: string;
  /** Trend indicator */
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
  /** Click handler (makes card clickable) */
  onClick?: () => void;
  /** Additional className for container */
  className?: string;
  /** Render custom content instead of value */
  children?: ReactNode;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  colorType = 'total',
  iconBgColor,
  iconColor,
  subtitle,
  trend,
  onClick,
  className = '',
  children,
}: StatCardProps) {
  // Get colors from preset or use custom
  const colors = STAT_CARD_COLORS[colorType] || STAT_CARD_COLORS.total;
  const finalIconBg = iconBgColor || colors.iconBg;
  const finalIconColor = iconColor || colors.iconColor;

  // Format value if number
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value;

  const cardContent = (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-400 mb-1 truncate">{label}</p>
        {children ? (
          children
        ) : (
          <p className="text-2xl font-semibold text-white truncate">{displayValue}</p>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>
        )}
        {trend && (
          <div className="flex items-center mt-2">
            <span className={`text-sm font-medium ${
              trend.isPositive ? 'text-green-400' : 'text-red-400'
            }`}>
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}{trend.label || '%'}
            </span>
            {!trend.label && (
              <span className="text-xs text-muted-foreground ml-2">vs last period</span>
            )}
          </div>
        )}
      </div>
      <div className={`w-12 h-12 ${finalIconBg} rounded-lg flex items-center justify-center flex-shrink-0 ml-4`}>
        <Icon className={`w-6 h-6 ${finalIconColor}`} />
      </div>
    </div>
  );

  const baseClasses = `bg-[#1a1d23] rounded-lg p-6 border border-gray-700/50 ${className}`;

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`${baseClasses} w-full text-left hover:bg-[#1e2128] hover:border-gray-600 transition-colors cursor-pointer`}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div className={baseClasses}>
      {cardContent}
    </div>
  );
}

// Grid wrapper for multiple stat cards
export interface StatCardGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

export function StatCardGrid({
  children,
  columns = 4,
  className = ''
}: StatCardGridProps) {
  const gridClass = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5',
  }[columns];

  return (
    <div className={`grid ${gridClass} gap-6 ${className}`}>
      {children}
    </div>
  );
}

export default StatCard;
